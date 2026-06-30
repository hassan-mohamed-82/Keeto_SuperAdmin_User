"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getResturantSchedules = exports.getHomeRestaurants = exports.removeFromHome = exports.toggleAddHome = exports.searchRestaurants = void 0;
exports.calculateCurrentStatus = calculateCurrentStatus;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
// Helper: حذف الباسورد وتحويل 0/1 لـ true/false
const cleanRestaurantResult = (row) => {
    const { password, ...safe } = row;
    return {
        ...safe,
        isFavorite: !!row.isFavorite,
        isAddHome: !!row.isAddHome,
    };
};
// 1. Search for restaurants
const searchRestaurants = async (req, res) => {
    const { query } = req.query;
    const userId = req.user?.id;
    if (!userId)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    if (!query || typeof query !== "string") {
        throw new Errors_1.BadRequest("Search query is required");
    }
    const searchTerm = `%${query}%`;
    const results = await connection_1.db
        .select({
        ...(0, drizzle_orm_1.getTableColumns)(schema_1.restaurants),
        isFavorite: (0, drizzle_orm_1.sql) `CASE WHEN ${schema_1.favorites.id} IS NOT NULL THEN true ELSE false END`.as('isFavorite'),
        isAddHome: (0, drizzle_orm_1.sql) `CASE WHEN ${schema_1.userAddHome.id} IS NOT NULL THEN true ELSE false END`.as('isAddHome')
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.favorites, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.favorites.restaurantId, schema_1.restaurants.id), (0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId)))
        .leftJoin(schema_1.userAddHome, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userAddHome.restaurantId, schema_1.restaurants.id), (0, drizzle_orm_1.eq)(schema_1.userAddHome.userId, userId)))
        .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.restaurants.name, searchTerm), (0, drizzle_orm_1.like)(schema_1.restaurants.nameAr, searchTerm), (0, drizzle_orm_1.like)(schema_1.restaurants.nameFr, searchTerm)));
    return (0, response_1.SuccessResponse)(res, { message: "Search results", data: results.map(cleanRestaurantResult) });
};
exports.searchRestaurants = searchRestaurants;
// 2. Toggle addhome status for a restaurant (add or remove)
const toggleAddHome = async (req, res) => {
    const { restaurantId } = req.params;
    const { addhome } = req.body;
    const userId = req.user?.id;
    if (!userId)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    if (typeof addhome !== "boolean") {
        throw new Errors_1.BadRequest("addhome status must be a boolean (true or false)");
    }
    const restaurant = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId))
        .limit(1);
    if (!restaurant[0]) {
        throw new Errors_1.NotFound("Restaurant not found");
    }
    if (addhome) {
        // Insert into userAddHome if not exists
        const existing = await connection_1.db
            .select()
            .from(schema_1.userAddHome)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userAddHome.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userAddHome.restaurantId, restaurantId)));
        if (existing.length === 0) {
            await connection_1.db.insert(schema_1.userAddHome).values({ userId, restaurantId });
        }
    }
    else {
        // Delete from userAddHome
        await connection_1.db
            .delete(schema_1.userAddHome)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userAddHome.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userAddHome.restaurantId, restaurantId)));
    }
    return (0, response_1.SuccessResponse)(res, { message: "Restaurant home status updated successfully" });
};
exports.toggleAddHome = toggleAddHome;
// 3. Remove restaurant from home (shortcut endpoint)
const removeFromHome = async (req, res) => {
    const { restaurantId } = req.params;
    const userId = req.user?.id;
    if (!userId)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    await connection_1.db
        .delete(schema_1.userAddHome)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userAddHome.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userAddHome.restaurantId, restaurantId)));
    return (0, response_1.SuccessResponse)(res, { message: "Restaurant removed from home successfully" });
};
exports.removeFromHome = removeFromHome;
// 4. Get all restaurants that are added to home
const getHomeRestaurants = async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const results = await connection_1.db
        .select({
        ...(0, drizzle_orm_1.getTableColumns)(schema_1.restaurants),
        isFavorite: (0, drizzle_orm_1.sql) `CASE WHEN ${schema_1.favorites.id} IS NOT NULL THEN true ELSE false END`.as('isFavorite'),
        isAddHome: (0, drizzle_orm_1.sql) `true`.as('isAddHome')
    })
        .from(schema_1.userAddHome)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.userAddHome.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.favorites, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.favorites.restaurantId, schema_1.restaurants.id), (0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId)))
        .where((0, drizzle_orm_1.eq)(schema_1.userAddHome.userId, userId));
    return (0, response_1.SuccessResponse)(res, { message: "Home restaurants fetched successfully", data: results.map(cleanRestaurantResult) });
};
exports.getHomeRestaurants = getHomeRestaurants;
// 5. Get all restaurant schedules
const getResturantSchedules = async (req, res) => {
    const { restaurantId } = req.params;
    // 1. التأكد من وجود المطعم
    const [restaurant] = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId))
        .limit(1);
    if (!restaurant) {
        throw new Errors_1.NotFound("Restaurant not found");
    }
    // 2. جلب المواعيد والإعدادات العامة
    const schedules = await connection_1.db
        .select()
        .from(schema_1.restaurantSchedules)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSchedules.restaurantId, restaurantId));
    const [settings] = await connection_1.db
        .select()
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
        .limit(1);
    // 3. حساب الحالة الحالية للمطعم بتوقيت القاهرة
    const status = calculateCurrentStatus(settings, schedules);
    // 4. إرجاع كل البيانات للفرونت إند جاهزة
    return (0, response_1.SuccessResponse)(res, {
        message: "Restaurant schedules and current status fetched successfully",
        data: {
            isOpenNow: status.isOpenNow,
            canDeliveryNow: status.canDeliveryNow,
            canTakeawayNow: status.canTakeawayNow,
            reason: status.reason,
            // settings: settings || null,
            // schedules: schedules
        }
    });
};
exports.getResturantSchedules = getResturantSchedules;
// =========================================================================
// 🛠️ الفانكشن الذكية لحساب حالة المطعم (تستخدم للـ API وللـ Validation)
// =========================================================================
function calculateCurrentStatus(settings, schedules) {
    // 🛑 1. الحماية الافتراضية (Secure by Default): لو مفيش إعدادات، المطعم مقفول
    const defaultStatus = {
        isOpenNow: false,
        canDeliveryNow: false,
        canTakeawayNow: false,
        reason: "Restaurant configurations are incomplete"
    };
    if (!settings)
        return defaultStatus;
    // 🚨 2. فحص الإغلاق المؤقت (الزحمة أو الطوارئ) فوراً - Fail-Fast
    if (settings.isTemporarilyClosed) {
        return {
            isOpenNow: false,
            canDeliveryNow: false,
            canTakeawayNow: false,
            reason: "Restaurant is temporarily not accepting orders due to high volume"
        };
    }
    // 3. حساب وقت وتاريخ القاهرة الحالي
    const now = new Date();
    const cairoFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Africa/Cairo",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false
    });
    const parts = cairoFormatter.formatToParts(now);
    const getPart = (type) => parts.find(p => p.type === type)?.value || "00";
    const currentTimeStr = `${getPart("hour") === "24" ? "00" : getPart("hour")}:${getPart("minute")}`;
    const cairoDateObj = new Date(`${getPart("year")}-${getPart("month")}-${getPart("day")}T12:00:00`);
    const currentDOW = cairoDateObj.getDay(); // 0 = الأحد، 6 = السبت
    let isOpenBySchedule = false;
    // 4. التحقق من جدول المواعيد إذا لم يكن المطعم (Always Open)
    if (settings.isAlwaysOpen) {
        isOpenBySchedule = true;
    }
    else {
        const todaySchedule = schedules.find(s => s.dayOfWeek === currentDOW);
        if (todaySchedule) {
            if (todaySchedule.isOffDay) {
                return { isOpenNow: false, canDeliveryNow: false, canTakeawayNow: false, reason: "Today is an off day" };
            }
            if (todaySchedule.openingTime && todaySchedule.closingTime) {
                const openTime = todaySchedule.openingTime.slice(0, 5);
                const closeTime = todaySchedule.closingTime.slice(0, 5);
                if (closeTime > openTime) {
                    // شفت طبيعي ينتهي في نفس اليوم
                    if (currentTimeStr >= openTime && currentTimeStr <= closeTime) {
                        isOpenBySchedule = true;
                    }
                }
                else {
                    // شفت يعبر منتصف الليل
                    if (currentTimeStr >= openTime || currentTimeStr <= closeTime) {
                        isOpenBySchedule = true;
                    }
                }
            }
        }
        else {
            // لو مفيش جدول مسجل للمطعم، نعتبره مغلق
            return { isOpenNow: false, canDeliveryNow: false, canTakeawayNow: false, reason: "No schedule registered for today" };
        }
    }
    if (!isOpenBySchedule) {
        return { isOpenNow: false, canDeliveryNow: false, canTakeawayNow: false, reason: "Restaurant is currently closed" };
    }
    // 5. دمج المواعيد مع إعدادات التوصيل والاستلام العامة للمطعم
    return {
        isOpenNow: true,
        canDeliveryNow: Boolean(settings.homeDelivery || settings.selfDelivery),
        canTakeawayNow: Boolean(settings.takeaway),
        reason: "Restaurant is open and active"
    };
}
