import cron from "node-cron";
import { db } from "../models/connection";
import { orders, restaurantSettings } from "../models/schema";
import { eq, inArray } from "drizzle-orm";
import { sendPushNotification } from "../utils/notifications";

// In-memory Map to keep track of alerted overdue orders
const alertedOverdueOrders = new Map<string, number>();

export function initOrderNotificationCron() {
  console.log("⏰ Order Notification Cron Service initialized...");

  // Run every minute: '*/1 * * * *'
  cron.schedule("*/1 * * * *", async () => {
    try {
      const now = new Date();
      const currentActiveOrderIds = new Set<string>();

      // جلب كافة الطلبات النشطة مع الإعدادات باستخدام المسميات الجديدة
      const activeOrders = await db
        .select({
          orderId: orders.id,
          orderNumber: orders.orderNumber,
          dailyOrderNumber: orders.dailyOrderNumber,
          restaurantId: orders.restaurantId,
          branchId: orders.branchId,
          status: orders.status,
          createdAt: orders.createdAt,
          updatedAt: orders.updatedAt,
          durationOrderPreparing: orders.durationOrderPreparing,
          repeatNotification: restaurantSettings.repeatNotification,
          repeatNotificationDuration: restaurantSettings.repeatNotificationDuration,
          repeatNotificationStatuses: restaurantSettings.repeatNotificationStatuses,
        })
        .from(orders)
        .leftJoin(restaurantSettings, eq(orders.restaurantId, restaurantSettings.restaurantId))
        .where(inArray(orders.status, ["pending", "accepted", "preparing", "out_for_delivery"]));

      const alertPromises = activeOrders.map(async (order) => {
        if (!order.createdAt) return;

        currentActiveOrderIds.add(order.orderId);

        const isRepeatEnabled = order.repeatNotification ?? false;
        // القيمة الافتراضية للحالات المسموحة هي ["pending"] فقط
        const allowedStatuses = order.repeatNotificationStatuses || ["pending"];

        if (!isRepeatEnabled || !order.status || !allowedStatuses.includes(order.status)) {
          return;
        }

        const thresholdMinutes =
          order.durationOrderPreparing && order.durationOrderPreparing > 0
            ? order.durationOrderPreparing
            : (order.repeatNotificationDuration ?? 20);

        const elapsedMinutes = Math.floor(
          (now.getTime() - new Date(order.createdAt).getTime()) / 60000
        );

        if (elapsedMinutes >= thresholdMinutes) {
          const lastAlertTime = alertedOverdueOrders.get(order.orderId) || 0;

          // التنبيه كحد أقصى مرة كل 10 دقائق
          if (now.getTime() - lastAlertTime > 10 * 60 * 1000) {
            alertedOverdueOrders.set(order.orderId, now.getTime());

            let statusAr = "معلق";
            if (order.status === "accepted") statusAr = "مقبول";
            else if (order.status === "preparing") statusAr = "جاري التحضير";
            else if (order.status === "out_for_delivery") statusAr = "خرج للتوصيل";

            const title =
              order.status === "pending"
                ? "طلب معلق يتطلب الانتباه! ⏳"
                : "تنبيه تأخير الطلب! ⚠️";

            const body =
              order.status === "pending"
                ? `الطلب #${order.dailyOrderNumber} ما زال معلقاً منذ ${elapsedMinutes} دقيقة ولم يتم قبوله بعد!`
                : `الطلب #${order.dailyOrderNumber} في حالة (${statusAr}) استغرق ${elapsedMinutes} دقيقة وتجاوز الوقت المحدد (${thresholdMinutes} دقيقة)!`;

            return sendPushNotification({
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
    } catch (error) {
      console.error("❌ Error running order notification cron:", error);
    }
  });
}