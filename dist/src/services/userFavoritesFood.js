"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserFavoritesSets = void 0;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const getUserFavoritesSets = async (userId) => {
    const favoriteRestaurantIds = new Set();
    const favoriteFoodIds = new Set();
    if (!userId)
        return { favoriteRestaurantIds, favoriteFoodIds };
    const userFavorites = await connection_1.db
        .select({
        restaurantId: schema_1.favorites.restaurantId,
        foodId: schema_1.favorites.foodId,
    })
        .from(schema_1.favorites)
        .where((0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId));
    userFavorites.forEach(f => {
        if (f.restaurantId)
            favoriteRestaurantIds.add(f.restaurantId);
        if (f.foodId)
            favoriteFoodIds.add(f.foodId);
    });
    return { favoriteRestaurantIds, favoriteFoodIds };
};
exports.getUserFavoritesSets = getUserFavoritesSets;
