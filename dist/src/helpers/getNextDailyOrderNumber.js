"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDailyOrderResetStart = void 0;
exports.getNextDailyOrderNumber = getNextDailyOrderNumber;
const dayjs_1 = __importDefault(require("dayjs"));
const utc_1 = __importDefault(require("dayjs/plugin/utc"));
const timezone_1 = __importDefault(require("dayjs/plugin/timezone"));
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
dayjs_1.default.extend(utc_1.default);
dayjs_1.default.extend(timezone_1.default);
const TIMEZONE = "Africa/Cairo";
const getDailyOrderResetStart = (resetTimeStr, now = new Date()) => {
    const [h, m] = (resetTimeStr || "00:00").split(":").map(Number);
    const nowCairo = (0, dayjs_1.default)(now).tz(TIMEZONE);
    let start = nowCairo
        .hour(Number.isFinite(h) ? h : 0)
        .minute(Number.isFinite(m) ? m : 0)
        .second(0)
        .millisecond(0);
    if (nowCairo.isBefore(start))
        start = start.subtract(1, "day");
    return start.toDate();
};
exports.getDailyOrderResetStart = getDailyOrderResetStart;
async function getNextDailyOrderNumber(tx, restaurantId, settings, now) {
    const shiftStart = (0, exports.getDailyOrderResetStart)(settings?.resetDailyOrderNumberTime, now);
    const shiftKey = shiftStart.toISOString();
    // seed: أعلى رقم موجود في الشيفت (بيتستخدم بس لو ده أول طلب في الشيفت)
    // من غير .for("update"): الـ lock الفعلي بيحصل على صف الـ counter تحت
    const [row] = await tx
        .select({ maxNum: (0, drizzle_orm_1.sql) `COALESCE(MAX(${schema_1.orders.dailyOrderNumber}), 0)` })
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), (0, drizzle_orm_1.gte)(schema_1.orders.createdAt, shiftStart)));
    const seed = Number(row?.maxNum || 0) + 1;
    // لو الصف مش موجود: يتعمل بقيمة seed. لو موجود: +1
    await tx.execute((0, drizzle_orm_1.sql) `
        INSERT INTO daily_order_counters (restaurant_id, shift_key, last_number)
        VALUES (${restaurantId}, ${shiftKey}, ${seed})
        ON DUPLICATE KEY UPDATE last_number = last_number + 1
    `);
    // القراءة جوه نفس الـ tx والصف مقفول عندك، فالرقم بتاعك انت بس
    const [rows] = await tx.execute((0, drizzle_orm_1.sql) `
        SELECT last_number FROM daily_order_counters
        WHERE restaurant_id = ${restaurantId} AND shift_key = ${shiftKey}
    `);
    return Number(rows[0].last_number);
}
