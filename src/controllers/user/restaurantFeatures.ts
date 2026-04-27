import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurants } from "../../models/schema";
import { eq, like, or } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { NotFound, BadRequest } from "../../Errors";

// 1. Search for restaurants
export const searchRestaurants = async (req: Request, res: Response) => {
    const { query } = req.query;
    
    if (!query || typeof query !== "string") {
        throw new BadRequest("Search query is required");
    }

    const searchTerm = `%${query}%`;

    const results = await db
        .select()
        .from(restaurants)
        .where(
            or(
                like(restaurants.name, searchTerm),
                like(restaurants.nameAr, searchTerm),
                like(restaurants.nameFr, searchTerm)
            )
        );

    return SuccessResponse(res, { message: "Search results", data: results });
};

// 2. Toggle addhome status for a restaurant
export const toggleAddHome = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;
    const { addhome } = req.body;

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

    await db.update(restaurants)
        .set({ addhome, updatedAt: new Date() })
        .where(eq(restaurants.id, restaurantId));

    return SuccessResponse(res, { message: "Restaurant home status updated successfully" });
};

// 3. Get all restaurants that are added to home
export const getHomeRestaurants = async (req: Request, res: Response) => {
    const results = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.addhome, true));

    return SuccessResponse(res, { message: "Home restaurants fetched successfully", data: results });
};
