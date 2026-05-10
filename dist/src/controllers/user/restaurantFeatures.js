"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHomeRestaurants = exports.toggleAddHome = exports.searchRestaurants = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
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
    return (0, response_1.SuccessResponse)(res, { message: "Search results", data: results });
};
exports.searchRestaurants = searchRestaurants;
// 2. Toggle addhome status for a restaurant
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
// 3. Get all restaurants that are added to home
const getHomeRestaurants = async (req, res) => {
    const userId = req.user?.id;
    if (!userId)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const results = await connection_1.db
        .select({
        ...(0, drizzle_orm_1.getTableColumns)(schema_1.restaurants),
        isFavorite: (0, drizzle_orm_1.sql) `CASE WHEN ${schema_1.favorites.id} IS NOT NULL THEN true ELSE false END`.as('isFavorite'),
        isAddHome: (0, drizzle_orm_1.sql) `true`.as('isAddHome') // Already filtered by userAddHome inner join
    })
        .from(schema_1.userAddHome)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.userAddHome.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.favorites, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.favorites.restaurantId, schema_1.restaurants.id), (0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId)))
        .where((0, drizzle_orm_1.eq)(schema_1.userAddHome.userId, userId));
    return (0, response_1.SuccessResponse)(res, { message: "Home restaurants fetched successfully", data: results });
};
exports.getHomeRestaurants = getHomeRestaurants;
