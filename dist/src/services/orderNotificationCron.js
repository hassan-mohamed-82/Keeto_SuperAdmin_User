"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initOrderNotificationCron = initOrderNotificationCron;
const node_cron_1 = __importDefault(require("node-cron"));
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const notifications_1 = require("../utils/notifications");
// In-memory Map to keep track of alerted overdue orders
const alertedOverdueOrders = new Map();
function initOrderNotificationCron() {
    console.log("⏰ Order Notification Cron Service initialized...");
    // Run every minute: '*/1 * * * *'
    node_cron_1.default.schedule("*/1 * * * *", async () => {
        try {
            const now = new Date();
            const currentActiveOrderIds = new Set();
            // جلب كافة الطلبات النشطة مع الإعدادات باستخدام المسميات الجديدة
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
                // القيمة الافتراضية للحالات المسموحة هي ["pending"] فقط
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
                    // التنبيه كحد أقصى مرة كل 10 دقائق
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
            // تنظيف الـ Cache للطلبات المنتهية
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
}
