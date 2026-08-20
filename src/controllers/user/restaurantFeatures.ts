import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurants, favorites, userAddHome, restaurantSchedules, restaurantSettings, branches, cities, zones } from "../../models/schema"; 
import { eq, like, or, and, sql, getTableColumns } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound, BadRequest, UnauthorizedError } from "../../Errors";

// Helper: حذف الباسورد وتحويل 0/1 لـ true/false
const cleanRestaurantResult = (row: any) => {
    const { password, ...safe } = row;
    return {
        ...safe,
        isFavorite: !!row.isFavorite,
        isAddHome: !!row.isAddHome,
    };
};

// 1. Search for restaurants
export const searchRestaurants = async (req: Request, res: Response) => {

    const { query } = req.query;
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError("Unauthenticated");

    if (!query || typeof query !== "string") {
        throw new BadRequest("Search query is required");
    }
    const searchTerm = `%${query}%`;

    const results = await db
    .select({
        ...getTableColumns(restaurants),
        isFavorite: sql<boolean>`CASE WHEN ${favorites.id} IS NOT NULL THEN true ELSE false END`.as('isFavorite'),
        isAddHome: sql<boolean>`CASE WHEN ${userAddHome.id} IS NOT NULL THEN true ELSE false END`.as('isAddHome')
    })
    .from(restaurants)
    .leftJoin(
        favorites,
            and(
                eq(favorites.restaurantId, restaurants.id),
                eq(favorites.userId, userId)
            )
        )
    .leftJoin(
            userAddHome,
            and(
                eq(userAddHome.restaurantId, restaurants.id),
                eq(userAddHome.userId, userId)
            )
        )
        .where(
            or(
                like(restaurants.name, searchTerm),
                like(restaurants.nameAr, searchTerm),
                like(restaurants.nameFr, searchTerm)
            )
        );
    return SuccessResponse(res, { message: "Search results", data: results.map(cleanRestaurantResult) });
}; 


// 2. Toggle addhome status for a restaurant (add or remove)
export const toggleAddHome = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;
    const { addhome } = req.body;

    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError("Unauthenticated");

    if (typeof addhome !== "boolean") {
        throw new BadRequest("addhome status must be a boolean (true or false)");
    }

    const restaurant = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

    if (!restaurant[0]) {
        throw new NotFound("Restaurant not found");
    }

    if (addhome) {
        // Insert into userAddHome if not exists
        const existing = await db
            .select()
            .from(userAddHome)
            .where(and(eq(userAddHome.userId, userId), eq(userAddHome.restaurantId, restaurantId)));
            
        if(existing.length === 0) {
            await db.insert(userAddHome).values({ userId, restaurantId });
        }
    } else {
        // Delete from userAddHome
        await db
            .delete(userAddHome)
            .where(and(eq(userAddHome.userId, userId), eq(userAddHome.restaurantId, restaurantId)));
    }

    return SuccessResponse(res, { message: "Restaurant home status updated successfully" });
};

// 3. Remove restaurant from home (shortcut endpoint)
export const removeFromHome = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError("Unauthenticated");

    await db
        .delete(userAddHome)
        .where(and(eq(userAddHome.userId, userId), eq(userAddHome.restaurantId, restaurantId)));

    return SuccessResponse(res, { message: "Restaurant removed from home successfully" });
};

// 4. Get all restaurants that are added to home
export const getHomeRestaurants = async (req: Request, res: Response) => {
    const userId = req.user?.id; 
    if(!userId) throw new UnauthorizedError("Unauthenticated");

    const results = await db
        .select({
            ...getTableColumns(restaurants),
            isFavorite: sql<boolean>`CASE WHEN ${favorites.id} IS NOT NULL THEN true ELSE false END`.as('isFavorite'),
            isAddHome: sql<boolean>`true`.as('isAddHome')
        })
        .from(userAddHome)
        .innerJoin(restaurants, eq(userAddHome.restaurantId, restaurants.id))
        .leftJoin(
            favorites,
            and(
                eq(favorites.restaurantId, restaurants.id),
                eq(favorites.userId, userId)
            )
        )
        .where(eq(userAddHome.userId, userId));

    return SuccessResponse(res, { message: "Home restaurants fetched successfully", data: results.map(cleanRestaurantResult) });
};

// 5. Get all restaurant schedules
export const getResturantSchedules = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    // 1. التأكد من وجود المطعم
    const [restaurant] = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

    if (!restaurant) {
        throw new NotFound("Restaurant not found");
    }

    // 2. جلب المواعيد والإعدادات العامة
    const schedules = await db
        .select()
        .from(restaurantSchedules)
        .where(eq(restaurantSchedules.restaurantId, restaurantId));

    const [settings] = await db
        .select()
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, restaurantId))
        .limit(1);

    // 3. حساب الحالة الحالية للمطعم بتوقيت القاهرة
    const status = calculateCurrentStatus(settings, schedules);

    // 4. إرجاع كل البيانات للفرونت إند جاهزة
    return SuccessResponse(res, { 
        message: "Restaurant schedules and current status fetched successfully", 
        data: {
            isOpenNow: status.isOpenNow,
            canDeliveryNow: status.canDeliveryNow,
            canTakeawayNow: status.canTakeawayNow,
            canDineInNow: status.canDineInNow,
            reason: status.reason,
            // settings: settings || null,
            // schedules: schedules
        } 
    });
};

// =========================================================================
// 🛠️ الفانكشن الذكية لحساب حالة المطعم (تستخدم للـ API وللـ Validation)
// =========================================================================
export function calculateCurrentStatus(settings: any, schedules: any[]) {
    // 🛑 1. الحماية الافتراضية (Secure by Default): لو مفيش إعدادات، المطعم مقفول
    const defaultStatus = { 
        isOpenNow: false, 
        canDeliveryNow: false, 
        canTakeawayNow: false, 
        canDineInNow: false,
        reason: "Restaurant configurations are incomplete" 
    };
    if (!settings) return defaultStatus;

    // 🚨 2. فحص الإغلاق المؤقت (الزحمة أو الطوارئ) فوراً - Fail-Fast
    if (settings.isTemporarilyClosed) {
        return { 
            isOpenNow: false, 
            canDeliveryNow: false, 
            canTakeawayNow: false, 
            canDineInNow: false,
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
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || "00";

    const currentTimeStr = `${getPart("hour") === "24" ? "00" : getPart("hour")}:${getPart("minute")}`;
    const cairoDateObj = new Date(`${getPart("year")}-${getPart("month")}-${getPart("day")}T12:00:00`);
    const currentDOW = cairoDateObj.getDay(); // 0 = الأحد، 6 = السبت

    let isOpenBySchedule = false;

    // 4. التحقق من جدول المواعيد إذا لم يكن المطعم (Always Open)
    if (settings.isAlwaysOpen) {
        isOpenBySchedule = true;
    } else {
        const todaySchedule = schedules.find(s => s.dayOfWeek === currentDOW);
        
        if (todaySchedule) {
            if (todaySchedule.isOffDay) {
                return { isOpenNow: false, canDeliveryNow: false, canTakeawayNow: false, canDineInNow: false, reason: "Today is an off day" };
            }
            
            if (todaySchedule.openingTime && todaySchedule.closingTime) {
                const openTime = todaySchedule.openingTime.slice(0, 5);
                const closeTime = todaySchedule.closingTime.slice(0, 5);

                if (closeTime > openTime) {
                    // شفت طبيعي ينتهي في نفس اليوم
                    if (currentTimeStr >= openTime && currentTimeStr <= closeTime) {
                        isOpenBySchedule = true;
                    }
                } else {
                    // شفت يعبر منتصف الليل
                    if (currentTimeStr >= openTime || currentTimeStr <= closeTime) {
                        isOpenBySchedule = true;
                    }
                }
            }
        } else {
            // لو مفيش جدول مسجل للمطعم، نعتبره مغلق
            return { isOpenNow: false, canDeliveryNow: false, canTakeawayNow: false, canDineInNow: false, reason: "No schedule registered for today" };
        }
    }

    if (!isOpenBySchedule) {
        return { isOpenNow: false, canDeliveryNow: false, canTakeawayNow: false, canDineInNow: false, reason: "Restaurant is currently closed" };
    }

    // 5. دمج المواعيد مع إعدادات التوصيل والاستلام العامة للمطعم
    return {
        isOpenNow: true,
        canDeliveryNow: Boolean(settings.homeDelivery || settings.selfDelivery),
        canTakeawayNow: Boolean(settings.takeaway),
        canDineInNow: Boolean(settings.dineIn),
        reason: "Restaurant is open and active"
    };
}


// 6. Get all branches of a restaurant
export const getRestaurantsBranches = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;
    // const userId = req.user?.id;

    // if (!userId) throw new UnauthorizedError("Unauthenticated");

    const restaurant = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

    if (!restaurant[0]) {
        throw new NotFound("Restaurant not found");
    }

    const allBranches = await db
        .select({
            id: branches.id,
            restaurantId: branches.restaurantId,
            name: branches.name,
            nameAr: branches.nameAr,
            nameFr: branches.nameFr,
            address: branches.address,
            addressAr: branches.addressAr,
            addressFr: branches.addressFr,
            phoneNumber: branches.phoneNumber,
            deliveryRadiusKm: branches.deliveryRadiusKm,
            lat: branches.lat,
            lng: branches.lng,
            status: branches.status,
            createdAt: branches.createdAt,
            city: {
                id: cities.id,
                name: cities.name,
                nameAr: cities.nameAr,
                nameFr: cities.nameFr,
            },
            zone: {
                id: zones.id,
                name: zones.name,
                nameAr: zones.nameAr,
                nameFr: zones.nameFr,
            }
        })
        .from(branches)
        .leftJoin(cities, eq(branches.cityId, cities.id))
        .leftJoin(zones, eq(branches.zoneId, zones.id))
        .where(and(
            eq(branches.restaurantId, restaurantId),
            eq(branches.status, "active")
        ));

    return SuccessResponse(res, {
        message: "Restaurant branches fetched successfully",
        data: allBranches
    });
};