import { db } from "../models/connection";
import {
    orders,
    restaurantSettings,
    paymentMethods,
    paymentTransactions,
    cartItems,
    couponUsages,
    coupons,
    users,
} from "../models/schema";
import { eq, or, like, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getNextDailyOrderNumber } from "./getNextDailyOrderNumber";
import { sendPushNotification } from "../utils/notifications";
import { chargePendingServiceFee } from "../services/restaurantWalletService";
import { claimPaymentIssueNotification, releasePaymentIssueNotificationClaim } from "../services/orderNotificationCron";
import { calculateVisaCommission } from "../utils/calculateVisaCommission";
import { getActiveCustomGateway } from "../utils/getActiveCustomGateway";
import { getSystemVisaSettings } from "../utils/getSystemVisaSettings";

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

interface ConfirmPaymentOptions {
    orderId: string;
    gateway: "paymob" | "kashier" | "geidea";
    transactionId?: string;
    gatewayOrderId?: string;
    rawPayload?: any;
}

interface FailPaymentOptions {
    orderId: string;
    gateway: "paymob" | "kashier" | "geidea";
    transactionId?: string;
    gatewayOrderId?: string;
    failureReason: string;
    rawPayload?: any;
}

/**
 * دالة مركزية لتأكيد نجاح عملية الدفع الإلكتروني (Paymob / Kashier / Geidea)
 * 1. تمنع التكرار (Idempotency) إذا كان الأوردر مدفوعاً بالفعل
 * 2. تحسب الرقم التسلسلي اليومي للمطعم (dailyOrderNumber) لحظة السداد
 * 3. تحدث الأوردر إلى paid و accepted
 * 4. تحدث محفظة المطعم
 * 5. تسجل العملية بنجاح في جدول payment_transactions
 * 6. ترسل الـ Push Notification للمطعم بالرقم اليومي الجديد
 */
export async function confirmOrderPayment({
    orderId,
    gateway,
    transactionId,
    gatewayOrderId,
    rawPayload,
}: ConfirmPaymentOptions) {
    const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

    if (!order) {
        console.warn(`[ConfirmPayment]: Order ${orderId} not found.`);
        return { success: false, message: "Order not found" };
    }

    if (order.paymentStatus === "paid") {
        console.log(`[ConfirmPayment]: Order ${order.orderNumber} already paid.`);
        return { success: true, alreadyProcessed: true };
    }

    const now = new Date();
    let assignedDailyOrderNumber = order.dailyOrderNumber;

    // استخراج طريقة الدفع الرقمية
    const [digitalMethod] = await db
        .select()
        .from(paymentMethods)
        .where(
            or(
                like(paymentMethods.name, `%${gateway}%`),
                like(paymentMethods.name, "%visa%"),
                like(paymentMethods.name, "%card%"),
                like(paymentMethods.name, "%digital%")
            )
        )
        .limit(1);

    // إعدادات المطعم لحساب الشيفت و dailyOrderNumber
    const [settings] = await db
        .select()
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, order.restaurantId))
        .limit(1);

    await db.transaction(async (tx) => {
        // إذا لم يكن لديه رقم يومي بعد (أوردر أونلاين تم تأجيل رقمه)، نحسبه الآن
        if (!assignedDailyOrderNumber) {
            assignedDailyOrderNumber = await getNextDailyOrderNumber(
                tx,
                order.restaurantId,
                settings,
                now
            );
        }

        let resolvedVisaCommission = parseFloat(order.visaCommission as string || "0");
        if (order.paymentGatewayType === "CUSTOM" && resolvedVisaCommission <= 0) {
            try {
                const activeCustom = await getActiveCustomGateway(order.restaurantId);
                if (activeCustom?.record) {
                    resolvedVisaCommission = calculateVisaCommission(
                        order.totalAmount,
                        activeCustom.record.percentageValue,
                        activeCustom.record.fixedValue,
                        activeCustom.record.tax
                    );
                }
            } catch (err) {
                console.warn("[confirmOrderPayment] Failed to calculate custom gateway visaCommission:", err);
            }
        }

        if (order.paymentGatewayType === "SYSTEM" && resolvedVisaCommission <= 0) {
            try {
                const platformSettings = await getSystemVisaSettings();
                resolvedVisaCommission = calculateVisaCommission(
                    order.totalAmount,
                    platformSettings.percentageValue,
                    platformSettings.fixedValue,
                    platformSettings.tax
                );
            } catch (err) {
                console.warn("[confirmOrderPayment] Failed to calculate platform SYSTEM visaCommission:", err);
            }
        }

        // تحديث حالة الأوردر
        await tx
            .update(orders)
            .set({
                paymentStatus: "paid",
                paymentGateway: gateway,
                paymentTransactionId: transactionId || order.paymentTransactionId,
                paymentOrderId: gatewayOrderId || order.paymentOrderId,
                status: "pending",
                dailyOrderNumber: assignedDailyOrderNumber,
                paymentMethod: digitalMethod?.id || order.paymentMethod,
                visaCommission: resolvedVisaCommission.toFixed(2),
                paymentFailureReason: null, // تصفير سبب الفشل لأن المحاولة الحالية نجحت
                updatedAt: now,
            })
            .where(eq(orders.id, order.id));

        // تسجيل العملية في جدول payment_transactions
        await tx.insert(paymentTransactions).values({
            id: uuidv4(),
            orderId: order.id,
            orderNumber: order.orderNumber,
            userId: order.userId,
            restaurantId: order.restaurantId,
            gateway,
            transactionId: transactionId || null,
            gatewayOrderId: gatewayOrderId || order.paymentOrderId || null,
            amount: order.totalAmount,
            currency: "EGP",
            status: "success",
            failureReason: null,
            rawResponse: rawPayload || null,
            createdAt: now,
        });

        await chargePendingServiceFee(order.id, tx, "custom_paid");

        // تفريغ سلة العميل بعد نجاح وتأكيد الدفع الإلكتروني
        await tx.delete(cartItems).where(eq(cartItems.userId, order.userId));
    });

    // إرسال الإشعار للمطعم بالرقم اليومي المؤكد
    const cairoTimeFormatted = new Intl.DateTimeFormat("ar-EG", {
        timeZone: "Africa/Cairo",
        hour: "numeric",
        minute: "numeric",
        hour12: true,
    }).format(now);

    await sendPushNotification({
        recipientType: "restaurant",
        recipientId: order.restaurantId,
        branchId: order.branchId || null,
        title: "طلب جديد مؤكد! 🛒",
        body: `تم استلام طلب مدفوع جديد #${assignedDailyOrderNumber} بقيمة ${order.totalAmount} ج.م الساعة ${cairoTimeFormatted}.`,
        data: {
            restaurantId: order.restaurantId,
            orderId: order.id,
            orderNumber: order.orderNumber,
            branchId: order.branchId || null,
            type: "new_order",
            createdAt: now.toISOString(),
            dailyOrderNumber: assignedDailyOrderNumber,
        },
    });

    return {
        success: true,
        dailyOrderNumber: assignedDailyOrderNumber,
    };
}

/**
 * دالة مركزية لتسجيل فشل الدفع الإلكتروني (Paymob / Kashier / Geidea)
 * 1. تحديث الأوردر إلى status: "failed" و paymentStatus: "payment_failed"
 * 2. الاحتفاظ بسلة المستخدم كما هي (لم تُحذف عند checkout لفيزا)
 * 3. تسجيل العملية الفاشلة في payment_transactions
 * 4. استرجاع الكوبون في حال تم استخدامه
 */
export async function recordFailedPayment({
    orderId,
    gateway,
    transactionId,
    gatewayOrderId,
    failureReason,
    rawPayload,
}: FailPaymentOptions) {
    const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);

    if (!order) {
        console.warn(`[RecordFailedPayment]: Order ${orderId} not found.`);
        return { success: false, message: "Order not found" };
    }

    const now = new Date();

    await db.transaction(async (tx) => {
        // 1. تحديث حالة الأوردر إلى failed بدل cancelled أو الحذف
        await tx
            .update(orders)
            .set({
                status: "failed",
                paymentStatus: "payment_failed",
                paymentGateway: gateway,
                paymentTransactionId: transactionId || order.paymentTransactionId,
                paymentOrderId: gatewayOrderId || order.paymentOrderId,
                paymentFailureReason: failureReason || "Payment was rejected or failed",
                updatedAt: now,
            })
            .where(eq(orders.id, order.id));

        // 2. تسجيل العملية الفاشلة في payment_transactions
        await tx.insert(paymentTransactions).values({
            id: uuidv4(),
            orderId: order.id,
            orderNumber: order.orderNumber,
            userId: order.userId,
            restaurantId: order.restaurantId,
            gateway,
            transactionId: transactionId || null,
            gatewayOrderId: gatewayOrderId || order.paymentOrderId || null,
            amount: order.totalAmount,
            currency: "EGP",
            status: "failed",
            failureReason: failureReason || "Payment was rejected or failed",
            rawResponse: rawPayload || null,
            createdAt: now,
        });

        // 3. استرجاع الكوبون إن وجد حتى لا يخسره العميل
        const [usage] = await tx
            .select()
            .from(couponUsages)
            .where(eq(couponUsages.orderId, order.id))
            .limit(1);

        if (usage) {
            await tx.delete(couponUsages).where(eq(couponUsages.id, usage.id));
            if (usage.couponId) {
                await tx
                    .update(coupons)
                    .set({ usedCount: sql`GREATEST(used_count - 1, 0)` })
                    .where(eq(coupons.id, usage.couponId));
            }
        }
    });

    try {
        const claimed = await claimPaymentIssueNotification(
            order.id,
            "payment_failed",
            "payment_failed"
        );

        if (!claimed) {
            console.log(`[RecordFailedPayment]: Order ${order.orderNumber} already claimed or not eligible for payment issue notification.`);
            return { success: true };
        }

        const [customer] = await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, order.userId))
            .limit(1);

        const customerName = customer?.name || "Customer";
        const issueBodyAr = `فشلت عملية الدفع بالفيزا للطلب رقم ${order.orderNumber} (العميل: ${customerName}). تواصل مع العميل.`;
        const issueBodyEn = `Card payment failed for order ${order.orderNumber}. Contact the customer.`;

        try {
            await sendPushNotification({
                recipientType: "restaurant",
                recipientId: order.restaurantId,
                branchId: order.branchId || null,
                title: "فشل دفع الطلب",
                body: issueBodyAr,
                data: {
                    type: "payment_issue",
                    issueType: "payment_failed",
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    restaurantId: order.restaurantId,
                },
            });

            console.log(`[RecordFailedPayment]: Order ${order.orderNumber} payment failure notification sent.`);
        } catch (notificationError) {
            await releasePaymentIssueNotificationClaim(order.id, "payment_failed");
            console.error(`[RecordFailedPayment]: Failed to send payment failure notification for order ${order.orderNumber}:`, notificationError);
        }
    } catch (error) {
        console.error(`[RecordFailedPayment]: Failed to process payment failure notification for order ${order.orderNumber}:`, error);
    }

    console.log(`[RecordFailedPayment]: Order ${order.orderNumber} marked as FAILED. Reason: ${failureReason}`);
    return { success: true };
}
