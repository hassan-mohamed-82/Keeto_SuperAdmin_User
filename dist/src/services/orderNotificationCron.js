"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PENDING_PAYMENT_ALERT_MINUTES = void 0;
exports.claimPaymentIssueNotification = claimPaymentIssueNotification;
exports.releasePaymentIssueNotificationClaim = releasePaymentIssueNotificationClaim;
exports.notifyStuckPendingPayments = notifyStuckPendingPayments;
exports.initOrderNotificationCron = initOrderNotificationCron;
const node_cron_1 = __importDefault(require("node-cron"));
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const notifications_1 = require("../utils/notifications");
exports.PENDING_PAYMENT_ALERT_MINUTES = Number(process.env.PENDING_PAYMENT_ALERT_MINUTES ?? 2);
// In-memory Map to keep track of alerted overdue orders
const alertedOverdueOrders = new Map();
async function claimPaymentIssueNotification(orderId, issueType, expectedPaymentStatus) {
    try {
        const [result] = await connection_1.db.execute((0, drizzle_orm_1.sql) `
      UPDATE orders
      SET payment_issue_notified_at = NOW(),
          payment_issue_type = ${issueType}
      WHERE id = ${orderId}
        AND payment_issue_notified_at IS NULL
        AND payment_status = ${expectedPaymentStatus}
    `);
        return Number(result?.affectedRows ?? 0) === 1;
    }
    catch (error) {
        console.error(`[PaymentIssueClaim] Failed to claim order ${orderId}:`, error);
        return false;
    }
}
async function releasePaymentIssueNotificationClaim(orderId, issueType) {
    try {
        await connection_1.db.execute((0, drizzle_orm_1.sql) `
      UPDATE orders
      SET payment_issue_notified_at = NULL,
          payment_issue_type = NULL
      WHERE id = ${orderId}
        AND payment_issue_type = ${issueType}
    `);
    }
    catch (error) {
        console.error(`[PaymentIssueClaim] Failed to release order ${orderId} claim:`, error);
    }
}
async function notifyStuckPendingPayments() {
    const cutoff = new Date(Date.now() - exports.PENDING_PAYMENT_ALERT_MINUTES * 60 * 1000);
    const rows = await connection_1.db
        .select({
        id: schema_1.orders.id,
        orderNumber: schema_1.orders.orderNumber,
        restaurantId: schema_1.orders.restaurantId,
        branchId: schema_1.orders.branchId,
        createdAt: schema_1.orders.createdAt,
        customerName: schema_1.users.name,
    })
        .from(schema_1.orders)
        .leftJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.orders.userId, schema_1.users.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.paymentStatus, "pending_payment"), (0, drizzle_orm_1.lt)(schema_1.orders.createdAt, cutoff)));
    for (const order of rows) {
        const claimed = await claimPaymentIssueNotification(order.id, "pending_payment_stuck", "pending_payment");
        if (!claimed)
            continue;
        try {
            const customerName = order.customerName || "Customer";
            const minutes = Math.max(1, Math.round((Date.now() - new Date(order.createdAt ?? Date.now()).getTime()) / 60000));
            const bodyAr = `الطلب رقم ${order.orderNumber} ما زال بانتظار دفع الفيزا منذ ${minutes} دقيقة. تواصل مع العميل: ${customerName}.`;
            const bodyEn = `Order ${order.orderNumber} is still waiting for card payment (${minutes} min). Contact the customer: ${customerName}.`;
            await (0, notifications_1.sendPushNotification)({
                recipientType: "restaurant",
                recipientId: order.restaurantId,
                branchId: order.branchId || null,
                title: "طلب بانتظار الدفع | Order waiting for payment",
                body: `${bodyAr} / ${bodyEn}`,
                data: {
                    type: "payment_issue",
                    issueType: "pending_payment_stuck",
                    orderId: order.id,
                    orderNumber: order.orderNumber,
                    restaurantId: order.restaurantId,
                },
            });
        }
        catch (error) {
            await releasePaymentIssueNotificationClaim(order.id, "pending_payment_stuck");
            console.error(`[PaymentIssueCron] Failed to notify order ${order.orderNumber}:`, error);
        }
    }
}
function initOrderNotificationCron() {
    console.log("⏰ Order Notification Cron Service initialized...");
    node_cron_1.default.schedule("*/1 * * * *", async () => {
        try {
            const now = new Date();
            const currentActiveOrderIds = new Set();
            const activeOrders = await connection_1.db
                .select({
                orderId: schema_1.orders.id,
                orderNumber: schema_1.orders.orderNumber,
                dailyOrderNumber: schema_1.orders.dailyOrderNumber,
                restaurantId: schema_1.orders.restaurantId,
                branchId: schema_1.orders.branchId,
                status: schema_1.orders.status,
                createdAt: schema_1.orders.createdAt,
                updatedAt: schema_1.orders.updatedAt,
                durationOrderPreparing: schema_1.orders.durationOrderPreparing,
                repeatNotification: schema_1.restaurantSettings.repeatNotification,
                repeatNotificationDuration: schema_1.restaurantSettings.repeatNotificationDuration,
                repeatNotificationStatuses: schema_1.restaurantSettings.repeatNotificationStatuses,
            })
                .from(schema_1.orders)
                .leftJoin(schema_1.restaurantSettings, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, schema_1.restaurantSettings.restaurantId))
                .where((0, drizzle_orm_1.inArray)(schema_1.orders.status, ["pending", "accepted", "preparing", "out_for_delivery"]));
            const alertPromises = activeOrders.map(async (order) => {
                if (!order.createdAt)
                    return;
                currentActiveOrderIds.add(order.orderId);
                const isRepeatEnabled = order.repeatNotification ?? false;
                const allowedStatuses = order.repeatNotificationStatuses || ["pending"];
                if (!isRepeatEnabled || !order.status || !allowedStatuses.includes(order.status)) {
                    return;
                }
                const thresholdMinutes = order.durationOrderPreparing && order.durationOrderPreparing > 0
                    ? order.durationOrderPreparing
                    : (order.repeatNotificationDuration ?? 20);
                const elapsedMinutes = Math.floor((now.getTime() - new Date(order.createdAt).getTime()) / 60000);
                if (elapsedMinutes >= thresholdMinutes) {
                    const lastAlertTime = alertedOverdueOrders.get(order.orderId) || 0;
                    if (now.getTime() - lastAlertTime > 10 * 60 * 1000) {
                        alertedOverdueOrders.set(order.orderId, now.getTime());
                        let statusAr = "معلق";
                        if (order.status === "accepted")
                            statusAr = "مقبول";
                        else if (order.status === "preparing")
                            statusAr = "جاري التحضير";
                        else if (order.status === "out_for_delivery")
                            statusAr = "خرج للتوصيل";
                        const title = order.status === "pending"
                            ? "طلب معلق يتطلب الانتباه! ⏳"
                            : "تنبيه تأخير الطلب! ⚠️";
                        const body = order.status === "pending"
                            ? `الطلب #${order.dailyOrderNumber} ما زال معلقاً منذ ${elapsedMinutes} دقيقة ولم يتم قبوله بعد!`
                            : `الطلب #${order.dailyOrderNumber} في حالة (${statusAr}) استغرق ${elapsedMinutes} دقيقة وتجاوز الوقت المحدد (${thresholdMinutes} دقيقة)!`;
                        return (0, notifications_1.sendPushNotification)({
                            recipientType: "restaurant",
                            recipientId: order.restaurantId,
                            branchId: order.branchId || null,
                            title,
                            body,
                            data: {
                                type: "overdue_order_alert",
                                orderId: order.orderId,
                                dailyOrderNumber: order.dailyOrderNumber,
                                status: order.status,
                                elapsedMinutes,
                                thresholdMinutes,
                            },
                        });
                    }
                }
            });
            await Promise.allSettled(alertPromises);
            for (const orderId of alertedOverdueOrders.keys()) {
                if (!currentActiveOrderIds.has(orderId)) {
                    alertedOverdueOrders.delete(orderId);
                }
            }
        }
        catch (error) {
            console.error("❌ Error running order notification cron:", error);
        }
    });
    node_cron_1.default.schedule("*/5 * * * *", async () => {
        try {
            await notifyStuckPendingPayments();
        }
        catch (error) {
            console.error("❌ Error running stuck pending payment cron:", error);
        }
    });
}
