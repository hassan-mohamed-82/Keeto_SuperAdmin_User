"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirmOrderPayment = confirmOrderPayment;
exports.recordFailedPayment = recordFailedPayment;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const getNextDailyOrderNumber_1 = require("./getNextDailyOrderNumber");
const notifications_1 = require("../utils/notifications");
const restaurantWalletService_1 = require("../services/restaurantWalletService");
const orderNotificationCron_1 = require("../services/orderNotificationCron");
const calculateVisaCommission_1 = require("../utils/calculateVisaCommission");
const getActiveCustomGateway_1 = require("../utils/getActiveCustomGateway");
const getSystemVisaSettings_1 = require("../utils/getSystemVisaSettings");
const firstOrderDiscount_helper_1 = require("./firstOrderDiscount.helper");
const roundMoney = (amount) => Math.round(amount * 100) / 100;
/**
 * دالة مركزية لتأكيد نجاح عملية الدفع الإلكتروني (Paymob / Kashier / Geidea)
 * 1. تمنع التكرار (Idempotency) إذا كان الأوردر مدفوعاً بالفعل
 * 2. تحسب الرقم التسلسلي اليومي للمطعم (dailyOrderNumber) لحظة السداد
 * 3. تحدث الأوردر إلى paid و accepted
 * 4. تحدث محفظة المطعم
 * 5. تسجل العملية بنجاح في جدول payment_transactions
 * 6. ترسل الـ Push Notification للمطعم بالرقم اليومي الجديد
 */
async function confirmOrderPayment({ orderId, gateway, transactionId, gatewayOrderId, rawPayload, }) {
    const [order] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
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
    const [digitalMethod] = await connection_1.db
        .select()
        .from(schema_1.paymentMethods)
        .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.paymentMethods.name, `%${gateway}%`), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%visa%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%card%"), (0, drizzle_orm_1.like)(schema_1.paymentMethods.name, "%digital%")))
        .limit(1);
    // إعدادات المطعم لحساب الشيفت و dailyOrderNumber
    const [settings] = await connection_1.db
        .select()
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, order.restaurantId))
        .limit(1);
    await connection_1.db.transaction(async (tx) => {
        // إذا لم يكن لديه رقم يومي بعد (أوردر أونلاين تم تأجيل رقمه)، نحسبه الآن
        if (!assignedDailyOrderNumber) {
            assignedDailyOrderNumber = await (0, getNextDailyOrderNumber_1.getNextDailyOrderNumber)(tx, order.restaurantId, settings, now);
        }
        let resolvedVisaCommission = parseFloat(order.visaCommission || "0");
        if (order.paymentGatewayType === "CUSTOM" && resolvedVisaCommission <= 0) {
            try {
                const activeCustom = await (0, getActiveCustomGateway_1.getActiveCustomGateway)(order.restaurantId);
                if (activeCustom?.record) {
                    resolvedVisaCommission = (0, calculateVisaCommission_1.calculateVisaCommission)(order.totalAmount, activeCustom.record.percentageValue, activeCustom.record.fixedValue, activeCustom.record.tax);
                }
            }
            catch (err) {
                console.warn("[confirmOrderPayment] Failed to calculate custom gateway visaCommission:", err);
            }
        }
        if (order.paymentGatewayType === "SYSTEM" && resolvedVisaCommission <= 0) {
            try {
                const platformSettings = await (0, getSystemVisaSettings_1.getSystemVisaSettings)();
                resolvedVisaCommission = (0, calculateVisaCommission_1.calculateVisaCommission)(order.totalAmount, platformSettings.percentageValue, platformSettings.fixedValue, platformSettings.tax);
            }
            catch (err) {
                console.warn("[confirmOrderPayment] Failed to calculate platform SYSTEM visaCommission:", err);
            }
        }
        // تحديث حالة الأوردر
        await tx
            .update(schema_1.orders)
            .set({
            paymentStatus: "paid",
            paymentGateway: gateway,
            paymentTransactionId: transactionId || order.paymentTransactionId,
            paymentOrderId: gatewayOrderId || order.paymentOrderId,
            status: "accepted",
            dailyOrderNumber: assignedDailyOrderNumber,
            paymentMethod: digitalMethod?.id || order.paymentMethod,
            visaCommission: resolvedVisaCommission.toFixed(2),
            paymentFailureReason: null, // تصفير سبب الفشل لأن المحاولة الحالية نجحت
            createdAt: now,
            updatedAt: now,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, order.id));
        // تسجيل العملية في جدول payment_transactions
        await tx.insert(schema_1.paymentTransactions).values({
            id: (0, uuid_1.v4)(),
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
        await (0, restaurantWalletService_1.chargePendingServiceFee)(order.id, tx, "custom_paid");
        // تسجيل استخدام خصم الطلبات الأولى للدفع الإلكتروني إذا تم تطبيقه
        if (order.firstOrderDiscountId) {
            const discAmount = parseFloat(order.discountAmount || "0");
            await (0, firstOrderDiscount_helper_1.recordFirstOrderDiscountUsage)(order.firstOrderDiscountId, order.userId, order.id, discAmount, tx);
        }
        // تفريغ سلة العميل بعد نجاح وتأكيد الدفع الإلكتروني
        await tx.delete(schema_1.cartItems).where((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, order.userId));
    });
    // إرسال الإشعار للمطعم بالرقم اليومي المؤكد
    const cairoTimeFormatted = new Intl.DateTimeFormat("ar-EG", {
        timeZone: "Africa/Cairo",
        hour: "numeric",
        minute: "numeric",
        hour12: true,
    }).format(now);
    await (0, notifications_1.sendPushNotification)({
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
async function recordFailedPayment({ orderId, gateway, transactionId, gatewayOrderId, failureReason, rawPayload, }) {
    const [order] = await connection_1.db
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
        .limit(1);
    if (!order) {
        console.warn(`[RecordFailedPayment]: Order ${orderId} not found.`);
        return { success: false, message: "Order not found" };
    }
    const now = new Date();
    await connection_1.db.transaction(async (tx) => {
        // 1. تحديث حالة الأوردر إلى failed بدل cancelled أو الحذف
        await tx
            .update(schema_1.orders)
            .set({
            status: "failed",
            paymentStatus: "payment_failed",
            paymentGateway: gateway,
            paymentTransactionId: transactionId || order.paymentTransactionId,
            paymentOrderId: gatewayOrderId || order.paymentOrderId,
            paymentFailureReason: failureReason || "Payment was rejected or failed",
            updatedAt: now,
        })
            .where((0, drizzle_orm_1.eq)(schema_1.orders.id, order.id));
        // 2. تسجيل العملية الفاشلة في payment_transactions
        await tx.insert(schema_1.paymentTransactions).values({
            id: (0, uuid_1.v4)(),
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
            .from(schema_1.couponUsages)
            .where((0, drizzle_orm_1.eq)(schema_1.couponUsages.orderId, order.id))
            .limit(1);
        if (usage) {
            await tx.delete(schema_1.couponUsages).where((0, drizzle_orm_1.eq)(schema_1.couponUsages.id, usage.id));
            if (usage.couponId) {
                await tx
                    .update(schema_1.coupons)
                    .set({ usedCount: (0, drizzle_orm_1.sql) `GREATEST(used_count - 1, 0)` })
                    .where((0, drizzle_orm_1.eq)(schema_1.coupons.id, usage.couponId));
            }
        }
    });
    try {
        const claimed = await (0, orderNotificationCron_1.claimPaymentIssueNotification)(order.id, "payment_failed", "payment_failed");
        if (!claimed) {
            console.log(`[RecordFailedPayment]: Order ${order.orderNumber} already claimed or not eligible for payment issue notification.`);
            return { success: true };
        }
        const [customer] = await connection_1.db
            .select({ name: schema_1.users.name })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, order.userId))
            .limit(1);
        const customerName = customer?.name || "Customer";
        const issueBodyAr = `فشلت عملية الدفع بالفيزا للطلب رقم ${order.orderNumber} (العميل: ${customerName}). تواصل مع العميل.`;
        const issueBodyEn = `Card payment failed for order ${order.orderNumber}. Contact the customer.`;
        try {
            await (0, notifications_1.sendPushNotification)({
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
        }
        catch (notificationError) {
            await (0, orderNotificationCron_1.releasePaymentIssueNotificationClaim)(order.id, "payment_failed");
            console.error(`[RecordFailedPayment]: Failed to send payment failure notification for order ${order.orderNumber}:`, notificationError);
        }
    }
    catch (error) {
        console.error(`[RecordFailedPayment]: Failed to process payment failure notification for order ${order.orderNumber}:`, error);
    }
    console.log(`[RecordFailedPayment]: Order ${order.orderNumber} marked as FAILED. Reason: ${failureReason}`);
    return { success: true };
}
