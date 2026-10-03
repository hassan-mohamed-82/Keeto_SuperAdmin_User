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
        // تحديث حالة الأوردر
        await tx
            .update(schema_1.orders)
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
    console.log(`[RecordFailedPayment]: Order ${order.orderNumber} marked as FAILED. Reason: ${failureReason}`);
    return { success: true };
}
