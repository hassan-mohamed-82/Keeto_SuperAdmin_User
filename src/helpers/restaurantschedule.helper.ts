import { Request } from "express";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { db } from "../models/connection";
import { orders, restaurantSettings, restaurantSchedules } from "../models/schema";
import { eq, gte, lte } from "drizzle-orm";
import { BadRequest } from "../Errors/BadRequest";

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = "Africa/Cairo";

// ==========================================
// 1. Helper: حساب تاريخ بداية الشيفت الحالي للمطعم
// ==========================================
export const getRestaurantShiftStartTime = async (restaurantId: string): Promise<Date> => {
    // الوقت الحالي محول فوراً لتوقيت القاهرة
    const nowCairo = dayjs().tz(TIMEZONE);
    const currentDayOfWeek = nowCairo.day(); // 0 = Sunday, 6 = Saturday

    const [settings] = await db
        .select()
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, restaurantId))
        .limit(1);

    if (settings && !settings.isAlwaysOpen) {
        const allSchedules = await db
            .select()
            .from(restaurantSchedules)
            .where(eq(restaurantSchedules.restaurantId, restaurantId));

        const todaySchedule = allSchedules.find((s) => s.dayOfWeek === currentDayOfWeek);

        if (todaySchedule && todaySchedule.openingTime && !todaySchedule.isOffDay) {
            const [openHour, openMinute] = todaySchedule.openingTime.split(":").map(Number);

            // وقت الفتح لليوم الحالي بتوقيت القاهرة
            const todayOpeningTime = nowCairo
                .hour(openHour)
                .minute(openMinute)
                .second(0)
                .millisecond(0);

            // إذا كان الوقت الحالي قبل موعد الفتح اليومي -> الشيفت بدأ في اليوم السابق
            if (nowCairo.isBefore(todayOpeningTime)) {
                const yesterdayCairo = nowCairo.subtract(1, "day");
                const yesterdaySchedule = allSchedules.find((s) => s.dayOfWeek === yesterdayCairo.day());

                const [yOpenHour, yOpenMinute] = (yesterdaySchedule?.openingTime || "00:00").split(":").map(Number);

                return yesterdayCairo
                    .hour(yOpenHour)
                    .minute(yOpenMinute)
                    .second(0)
                    .millisecond(0)
                    .toDate();
            }

            return todayOpeningTime.toDate();
        }
    }

    // الافتراضي: بداية اليوم الحالي 00:00:00 بتوقيت القاهرة
    return nowCairo.startOf("day").toDate();
};

// ==========================================
// 2. Helper: بناء شروط التاريخ وفحص مدخلات المطور/العميل
// ==========================================
export const buildOrderDateConditions = async (req: Request, restaurantId: string): Promise<any[]> => {
    const conditions: any[] = [];

    const rawStartDate = (
        req.query?.startDate ||
        req.query?.start_date ||
        req.query?.startt ||
        req.query?.fromDate ||
        req.query?.from_date ||
        req.query?.date
    ) as string | undefined;

    const rawEndDate = (
        req.query?.endDate ||
        req.query?.end_date ||
        req.query?.toDate ||
        req.query?.to_date
    ) as string | undefined;

    let startDate: Date;
    let endDate: Date | undefined;

    // 1. معالجة تاريخ البداية
    if (rawStartDate) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawStartDate)) {
            // YYYY-MM-DD يحول لبداية اليوم بتوقيت القاهرة
            startDate = dayjs.tz(rawStartDate, TIMEZONE).startOf("day").toDate();
        } else {
            startDate = dayjs(rawStartDate).toDate();
        }
    } else {
        startDate = await getRestaurantShiftStartTime(restaurantId);
    }

    // 2. معالجة تاريخ النهاية
    if (rawEndDate) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawEndDate)) {
            // YYYY-MM-DD يحول لنهاية اليوم بتوقيت القاهرة (23:59:59)
            endDate = dayjs.tz(rawEndDate, TIMEZONE).endOf("day").toDate();
        } else {
            endDate = dayjs(rawEndDate).toDate();
        }
    }

    // 3. التحقق من صحة المدخلات (فحص خطأ startDate > endDate)
    if (startDate && endDate && startDate > endDate) {
        throw new BadRequest("startDate cannot be after endDate");
    }

    conditions.push(gte(orders.createdAt, startDate));
    if (endDate) {
        conditions.push(lte(orders.createdAt, endDate));
    }

    return conditions;
};
