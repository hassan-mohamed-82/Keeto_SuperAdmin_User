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

      // ====================================================
      // 1. Pending Orders Repeat Notification
      // ====================================================
      const pendingOrders = await db
        .select({
          orderId: orders.id,
          orderNumber: orders.orderNumber,
          dailyOrderNumber: orders.dailyOrderNumber,
          restaurantId: orders.restaurantId,
          branchId: orders.branchId,
          createdAt: orders.createdAt,
          repeatNotification: restaurantSettings.repeatNotification,
          repeatNotificationDuration: restaurantSettings.repeatNotificationDuration,
        })
        .from(orders)
        .leftJoin(restaurantSettings, eq(orders.restaurantId, restaurantSettings.restaurantId))
        .where(eq(orders.status, "pending"));

      const pendingPromises = pendingOrders.map(async (order) => {
        if (!order.createdAt) return;

        const elapsedMinutes = Math.floor((now.getTime() - new Date(order.createdAt).getTime()) / 60000);
        const maxDuration = order.repeatNotificationDuration ?? 5;
        const isRepeatEnabled = order.repeatNotification ?? false;

        // نبدأ التكرار بعد الدقيقة الأولى لتجنب التكرار مع إشعار الإنشاء اللحظي
        if (isRepeatEnabled && elapsedMinutes >= 1 && elapsedMinutes <= maxDuration) {
          return sendPushNotification({
            recipientType: "restaurant",
            recipientId: order.restaurantId,
            branchId: order.branchId || null,
            title: "طلب معلق! ⏳",
            body: `تنبيه: الطلب #${order.dailyOrderNumber} ما زال معلقاً منذ ${elapsedMinutes} دقيقة ولم يتم قبوله بعد!`,
            data: {
              type: "pending_order_reminder",
              orderId: order.orderId,
              dailyOrderNumber: order.dailyOrderNumber,
              elapsedMinutes,
            },
          });
        }
      });

      // ====================================================
      // 2. Overdue Active Orders Alert
      // ====================================================
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
          orderAlertNotification: restaurantSettings.orderAlertNotification,
          orderAlertDurationThreshold: restaurantSettings.orderAlertDurationThreshold,
          orderAlertStatuses: restaurantSettings.orderAlertStatuses,
        })
        .from(orders)
        .leftJoin(restaurantSettings, eq(orders.restaurantId, restaurantSettings.restaurantId))
        .where(inArray(orders.status, ["accepted", "preparing", "out_for_delivery"]));

      const activePromises = activeOrders.map(async (order) => {
        if (!order.createdAt) return;

        // تتبع الطلبات النشطة لحفظ السيرفر
        currentActiveOrderIds.add(order.orderId);

        const isAlertEnabled = order.orderAlertNotification ?? true;
        const allowedStatuses = order.orderAlertStatuses || ["accepted", "preparing", "out_for_delivery"];

        if (!order.status || !allowedStatuses.includes(order.status)) {
          return;
        }

        const thresholdMinutes = order.durationOrderPreparing && order.durationOrderPreparing > 0
          ? order.durationOrderPreparing
          : (order.orderAlertDurationThreshold ?? 20);

        const elapsedMinutes = Math.floor((now.getTime() - new Date(order.createdAt).getTime()) / 60000);

        if (isAlertEnabled && elapsedMinutes >= thresholdMinutes) {
          const lastAlertTime = alertedOverdueOrders.get(order.orderId) || 0;

          // التنبيه كحد أقصى مرة كل 10 دقائق
          if (now.getTime() - lastAlertTime > 10 * 60 * 1000) {
            alertedOverdueOrders.set(order.orderId, now.getTime());

            let statusAr = "قيد المعالجة";
            if (order.status === "accepted") statusAr = "مقبول";
            else if (order.status === "preparing") statusAr = "جاري التحضير";
            else if (order.status === "out_for_delivery") statusAr = "خرج للتوصيل";

            return sendPushNotification({
              recipientType: "restaurant",
              recipientId: order.restaurantId,
              branchId: order.branchId || null,
              title: "تنبيه تأخير الطلب! ⚠️",
              body: `الطلب #${order.dailyOrderNumber} في حالة (${statusAr}) استغرق ${elapsedMinutes} دقيقة وتجاوز الوقت المحدد (${thresholdMinutes} دقيقة) ولم يتم تسليمه بعد!`,
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

      // إرسال الإشعارات بالتوازي لجميع الطلبات لسرعة الأداء
      await Promise.allSettled([...pendingPromises, ...activePromises]);

      // ====================================================
      // 3. Smart Clean-up for Cache
      // ====================================================
      // حذف الطلبات التي انتهت (لم تعد نشطة) من الـ Map لمنع التسريب
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