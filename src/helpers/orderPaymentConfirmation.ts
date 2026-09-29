import { db } from "../models/connection";
import {
    orders,
    restaurantSettings,
    restaurantWallets,
    restaurantWalletTransactions,
    paymentMethods,
    paymentTransactions,
    cartItems,
    couponUsages,
    coupons,
} from "../models/schema";
import { eq, or, like, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { getNextDailyOrderNumber } from "./getNextDailyOrderNumber";
import { sendPushNotification } from "../utils/notifications";

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
                paymentFailureReason: null, // تصفير سبب الفشل لأن المحاولة الحالية نجحت
                updatedAt: now,
            })
            .where(eq(orders.id, order.id));

        // حسابات محفظة المطعم
        const subtotal = parseFloat(order.subtotal as string || "0");
        const deliveryFee = parseFloat(order.deliveryFee as string || "0");
        const appCommission = parseFloat(order.appCommission as string || "0");
        const restaurantEarning = roundMoney(subtotal + deliveryFee - appCommission);

        let [restaurantWallet] = await tx
            .select()
            .from(restaurantWallets)
            .where(eq(restaurantWallets.restaurantId, order.restaurantId))
            .for("update");

        if (!restaurantWallet) {
            await tx.insert(restaurantWallets).values({
                id: uuidv4(),
                restaurantId: order.restaurantId,
                balance: "0.00",
                collectedCash: "0.00",
                totalEarning: "0.00",
            });
            restaurantWallet = {
                balance: "0.00",
                collectedCash: "0.00",
                totalEarning: "0.00",
            } as any;
        }

        const currentRestBalance = parseFloat(restaurantWallet.balance as string);
        const currentTotalEarning = parseFloat(restaurantWallet.totalEarning as string);
        const newRestBalance = roundMoney(currentRestBalance + restaurantEarning);

        await tx
            .update(restaurantWallets)
            .set({
                balance: newRestBalance.toFixed(2),
                totalEarning: roundMoney(currentTotalEarning + restaurantEarning).toFixed(2),
            })
            .where(eq(restaurantWallets.restaurantId, order.restaurantId));

        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId: order.restaurantId,
            type: "order_payment",
            amount: `${restaurantEarning.toFixed(2)}`,
            balanceBefore: currentRestBalance.toFixed(2),
            balanceAfter: newRestBalance.toFixed(2),
            method: digitalMethod?.name || gateway,
            reference: order.orderNumber,
            note: `Earnings added from confirmed ${gateway} digital payment`,
            createdAt: now,
        });

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

    console.log(`[RecordFailedPayment]: Order ${order.orderNumber} marked as FAILED. Reason: ${failureReason}`);
    return { success: true };
}
