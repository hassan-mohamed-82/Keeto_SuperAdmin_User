import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { orders } from "../models/schema";
import { and, eq, gte, sql } from "drizzle-orm";

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = "Africa/Cairo";

export const getDailyOrderResetStart = (
    resetTimeStr: string | null | undefined,
    now: Date = new Date()
): Date => {
    const [h, m] = (resetTimeStr || "00:00").split(":").map(Number);
    const nowCairo = dayjs(now).tz(TIMEZONE);

    let start = nowCairo
        .hour(Number.isFinite(h) ? h : 0)
        .minute(Number.isFinite(m) ? m : 0)
        .second(0)
        .millisecond(0);

    if (nowCairo.isBefore(start)) start = start.subtract(1, "day");
    return start.toDate();
};

export async function getNextDailyOrderNumber(
    tx: any,
    restaurantId: string,
    settings: any,
    now: Date
): Promise<number> {
    const shiftStart = getDailyOrderResetStart(settings?.resetDailyOrderNumberTime, now);
    const shiftKey = shiftStart.toISOString();

    // seed: أعلى رقم موجود في الشيفت (بيتستخدم بس لو ده أول طلب في الشيفت)
    // من غير .for("update"): الـ lock الفعلي بيحصل على صف الـ counter تحت
    const [row] = await tx
        .select({ maxNum: sql<number>`COALESCE(MAX(${orders.dailyOrderNumber}), 0)` })
        .from(orders)
        .where(and(eq(orders.restaurantId, restaurantId), gte(orders.createdAt, shiftStart)));
    const seed = Number(row?.maxNum || 0) + 1;

    // لو الصف مش موجود: يتعمل بقيمة seed. لو موجود: +1
    await tx.execute(sql`
        INSERT INTO daily_order_counters (restaurant_id, shift_key, last_number)
        VALUES (${restaurantId}, ${shiftKey}, ${seed})
        ON DUPLICATE KEY UPDATE last_number = last_number + 1
    `);

    // القراءة جوه نفس الـ tx والصف مقفول عندك، فالرقم بتاعك انت بس
    const [rows] = await tx.execute(sql`
        SELECT last_number FROM daily_order_counters
        WHERE restaurant_id = ${restaurantId} AND shift_key = ${shiftKey}
    `);
    return Number((rows as any[])[0].last_number);
}