"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateUserNotBlocked = void 0;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const BadRequest_1 = require("../Errors/BadRequest");
/**
 * Validates that a user is neither globally blocked/deleted
 * nor blocked by the specific restaurant.
 * Throws BadRequest error if blocked.
 */
const validateUserNotBlocked = async (userId, restaurantId) => {
    if (!userId) {
        throw new BadRequest_1.BadRequest("User ID is required");
    }
    // 1. General User Check (users table)
    const [user] = await connection_1.db
        .select({
        status: schema_1.users.status,
        isDeleted: schema_1.users.isDeleted
    })
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId))
        .limit(1);
    if (!user) {
        throw new BadRequest_1.BadRequest("User account not found");
    }
    if (user.isDeleted) {
        throw new BadRequest_1.BadRequest("Your account has been deleted");
    }
    if (user.status === "blocked") {
        throw new BadRequest_1.BadRequest("Your account has been blocked by administration");
    }
    // 2. Specific Restaurant User Check (restaurant_users table)
    if (restaurantId) {
        const [restaurantUser] = await connection_1.db
            .select({
            status: schema_1.restaurant_users.status
        })
            .from(schema_1.restaurant_users)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurant_users.userId, userId), (0, drizzle_orm_1.eq)(schema_1.restaurant_users.restaurantId, restaurantId)))
            .limit(1);
        if (restaurantUser && restaurantUser.status === "blocked") {
            throw new BadRequest_1.BadRequest("You are blocked by this restaurant");
        }
    }
};
exports.validateUserNotBlocked = validateUserNotBlocked;
