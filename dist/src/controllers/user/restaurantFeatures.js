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
    if (!query || typeof query !== "string") {
        throw new Errors_1.BadRequest("Search query is required");
    }
    const searchTerm = `%${query}%`;
    const results = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.restaurants.name, searchTerm), (0, drizzle_orm_1.like)(schema_1.restaurants.nameAr, searchTerm), (0, drizzle_orm_1.like)(schema_1.restaurants.nameFr, searchTerm)));
    return (0, response_1.SuccessResponse)(res, { message: "Search results", data: results });
};
exports.searchRestaurants = searchRestaurants;
// 2. Toggle addhome status for a restaurant
const toggleAddHome = async (req, res) => {
    const { restaurantId } = req.params;
    const { addhome } = req.body;
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
    await connection_1.db.update(schema_1.restaurants)
        .set({ addhome, updatedAt: new Date() })
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId));
    return (0, response_1.SuccessResponse)(res, { message: "Restaurant home status updated successfully" });
};
exports.toggleAddHome = toggleAddHome;
// 3. Get all restaurants that are added to home
const getHomeRestaurants = async (req, res) => {
    const results = await connection_1.db
        .select()
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.addhome, true));
    return (0, response_1.SuccessResponse)(res, { message: "Home restaurants fetched successfully", data: results });
};
exports.getHomeRestaurants = getHomeRestaurants;
