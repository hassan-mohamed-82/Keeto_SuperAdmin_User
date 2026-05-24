import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurants, favorites, userAddHome } from "../../models/schema"; 
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

    const cleanQuery = query.trim();
    const searchTerm = `%${cleanQuery}%`;

    // 1. بناء شروط البحث عن الجملة الكاملة (تطابق عادي أو عكسي)
    const searchConditions = [
        like(restaurants.name, searchTerm),
        like(restaurants.nameAr, searchTerm),
        like(restaurants.nameFr, searchTerm),
        // بحث عكسي: هل اسم المطعم موجود كجزء داخل الجملة التي كتبها المستخدم؟
        sql`POSITION(LOWER(${restaurants.name}) IN LOWER(${cleanQuery})) > 0`,
        sql`POSITION(${restaurants.nameAr} IN ${cleanQuery}) > 0`,
        sql`POSITION(LOWER(${restaurants.nameFr}) IN LOWER(${cleanQuery})) > 0`
    ];

    // 2. البحث الذكي المفكك: تقسيم الجملة لكلمات إذا كتب المستخدم أكثر من كلمة (مثل: "برجر ماك لارج")
    const words = cleanQuery.split(/\s+/).filter(word => word.length > 2); // نختار الكلمات التي تزيد عن حرفين
    if (words.length > 1) {
        words.forEach(word => {
            const wordTerm = `%${word}%`;
            searchConditions.push(
                like(restaurants.name, wordTerm),
                like(restaurants.nameAr, wordTerm),
                like(restaurants.nameFr, wordTerm)
            );
        });
    }

    // 3. تنفيذ الاستعلام المطور
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
        .where(or(...searchConditions)); // نمرر كل المصفوفة الذكية لشرط الـ OR

    return SuccessResponse(res, { 
        message: "Search results", 
        data: results.map(cleanRestaurantResult) 
    });
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