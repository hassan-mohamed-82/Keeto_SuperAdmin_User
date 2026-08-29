import { db } from "../models/connection";
import { favorites } from "../models/schema";
import { eq } from "drizzle-orm";

export const getUserFavoritesSets = async (userId?: string) => {
    const favoriteRestaurantIds = new Set<string>();
    const favoriteFoodIds = new Set<string>();

    if (!userId) return { favoriteRestaurantIds, favoriteFoodIds };

    const userFavorites = await db
        .select({
            restaurantId: favorites.restaurantId,
            foodId: favorites.foodId,
        })
        .from(favorites)
        .where(eq(favorites.userId, userId));

    userFavorites.forEach(f => {
        if (f.restaurantId) favoriteRestaurantIds.add(f.restaurantId);
        if (f.foodId) favoriteFoodIds.add(f.foodId);
    });

    return { favoriteRestaurantIds, favoriteFoodIds };
};