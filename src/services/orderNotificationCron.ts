import cron from "node-cron";
import { db } from "../models/connection";
import { orders, restaurantSettings, users } from "../models/schema";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { sendPushNotification } from "../utils/notifications";

export const PENDING_PAYMENT_ALERT_MINUTES = Number(process.env.PENDING_PAYMENT_ALERT_MINUTES ?? 2);

// In-memory Map to keep track of alerted overdue orders
const alertedOverdueOrders = new Map<string, number>();

export async function claimPaymentIssueNotification(
  orderId: string,
  issueType: "payment_failed" | "pending_payment_stuck",
  expectedPaymentStatus: "pending_payment" | "payment_failed"
): Promise<boolean> {
  try {
    const [result] = await db.execute(sql`
      UPDATE orders
      SET payment_issue_notified_at = NOW(),
          payment_issue_type = ${issueType}
      WHERE id = ${orderId}
        AND payment_issue_notified_at IS NULL
        AND payment_status = ${expectedPaymentStatus}
    `);

    return Number((result as any)?.affectedRows ?? 0) === 1;
  } catch (error) {
    console.error(`[PaymentIssueClaim] Failed to claim order ${orderId}:`, error);
    return false;
  }
}

export async function releasePaymentIssueNotificationClaim(
  orderId: string,
  issueType: "payment_failed" | "pending_payment_stuck"
): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE orders
      SET payment_issue_notified_at = NULL,
          payment_issue_type = NULL
      WHERE id = ${orderId}
        AND payment_issue_type = ${issueType}
    `);
  } catch (error) {
    console.error(`[PaymentIssueClaim] Failed to release order ${orderId} claim:`, error);
  }
}

export async function notifyStuckPendingPayments() {
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_ALERT_MINUTES * 60 * 1000);
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      restaurantId: orders.restaurantId,
      branchId: orders.branchId,
      createdAt: orders.createdAt,
      customerName: users.name,
    })
    .from(orders)
    .leftJoin(users, eq(orders.userId, users.id))
    .where(and(
      eq(orders.paymentStatus, "pending_payment"),
      lt(orders.createdAt, cutoff)
    ));

  for (const order of rows) {
    const claimed = await claimPaymentIssueNotification(order.id, "pending_payment_stuck", "pending_payment");
    if (!claimed) continue;

    try {
      const customerName = order.customerName || "Customer";
      const minutes = Math.max(1, Math.round((Date.now() - new Date(order.createdAt ?? Date.now()).getTime()) / 60000));
      const bodyAr = `الطلب رقم ${order.orderNumber} ما زال بانتظار دفع الفيزا منذ ${minutes} دقيقة. تواصل مع العميل: ${customerName}.`;
      const bodyEn = `Order ${order.orderNumber} is still waiting for card payment (${minutes} min). Contact the customer: ${customerName}.`;

      await sendPushNotification({
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
    } catch (error) {
      await releasePaymentIssueNotificationClaim(order.id, "pending_payment_stuck");
      console.error(`[PaymentIssueCron] Failed to notify order ${order.orderNumber}:`, error);
    }
  }
}

export function initOrderNotificationCron() {
  console.log("⏰ Order Notification Cron Service initialized...");

  cron.schedule("*/1 * * * *", async () => {
    try {
      const now = new Date();
      const currentActiveOrderIds = new Set<string>();

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

      for (const orderId of alertedOverdueOrders.keys()) {
        if (!currentActiveOrderIds.has(orderId)) {
          alertedOverdueOrders.delete(orderId);
        }
      }
    } catch (error) {
      console.error("❌ Error running order notification cron:", error);
    }
  });

  cron.schedule("*/5 * * * *", async () => {
    try {
      await notifyStuckPendingPayments();
    } catch (error) {
      console.error("❌ Error running stuck pending payment cron:", error);
    }
  });
}
