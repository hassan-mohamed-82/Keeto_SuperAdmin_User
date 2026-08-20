import { db } from "../models/connection";
import { users, restaurant_users } from "../models/schema";
import { eq, and } from "drizzle-orm";
import { BadRequest } from "../Errors/BadRequest";

/**
 * Validates that a user is neither globally blocked/deleted
 * nor blocked by the specific restaurant.
 * Throws BadRequest error if blocked.
 */
export const validateUserNotBlocked = async (userId: string, restaurantId?: string) => {
    if (!userId) {
        throw new BadRequest("User ID is required");
    }

    // 1. General User Check (users table)
    const [user] = await db
        .select({
            status: users.status,
            isDeleted: users.isDeleted
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (!user) {
        throw new BadRequest("User account not found");
    }

    if (user.isDeleted) {
        throw new BadRequest("Your account has been deleted");
    }

    if (user.status === "blocked") {
        throw new BadRequest("Your account has been blocked by administration");
    }

    // 2. Specific Restaurant User Check (restaurant_users table)
    if (restaurantId) {
        const [restaurantUser] = await db
            .select({
                status: restaurant_users.status
            })
            .from(restaurant_users)
            .where(
                and(
                    eq(restaurant_users.userId, userId),
                    eq(restaurant_users.restaurantId, restaurantId)
                )
            )
            .limit(1);

        if (restaurantUser && restaurantUser.status === "blocked") {
            throw new BadRequest("You are blocked by this restaurant");
        }
    }
};
