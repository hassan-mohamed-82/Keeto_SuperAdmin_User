import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantRatings, restaurants, users } from "../../models/schema";
import { userRestaurantPoints } from "../../models/schema/user/userRestaurantPoints";
import { eq, and, sql, avg, count } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { UnauthorizedError } from "../../Errors";
// ==========================================
// 1. Add or Update Rating (User)
// ==========================================
export const rateRestaurant = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
        throw new UnauthorizedError ("User not found");
    }
    const { restaurantId, rating, comment } = req.body;

    if (!restaurantId || !rating) {
        throw new BadRequest("restaurantId and rating are required");
    }

    if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        throw new BadRequest("Rating must be an integer between 1 and 5");
    }

    // تأكد المطعم موجود
    const [restaurant] = await db.select().from(restaurants)
        .where(eq(restaurants.id, restaurantId)).limit(1);
    if (!restaurant) throw new NotFound("Restaurant not found");

    // تأكد أن اليوزر عنده طلب واحد على الأقل من المطعم
    const [userPoints] = await db.select().from(userRestaurantPoints)
        .where(and(
            eq(userRestaurantPoints.userId, userId),
            eq(userRestaurantPoints.restaurantId, restaurantId)
        )).limit(1);

    if (!userPoints || userPoints.totalOrders < 1) {
        throw new BadRequest("You must have at least one completed order from this restaurant to rate it");
    }

    // شوف لو اليوزر عامل rating قبل كده
    const [existing] = await db.select().from(restaurantRatings)
        .where(and(
            eq(restaurantRatings.userId, userId),
            eq(restaurantRatings.restaurantId, restaurantId)
        )).limit(1);

    if (existing) {
        // Update
        await db.update(restaurantRatings)
            .set({ rating, comment: comment || null, updatedAt: new Date() })
            .where(eq(restaurantRatings.id, existing.id));

        return SuccessResponse(res, { message: "Rating updated successfully" });
    } else {
        // Insert
        await db.insert(restaurantRatings).values({
            userId,
            restaurantId,
            rating,
            comment: comment || null,
        });

        return SuccessResponse(res, { message: "Rating submitted successfully" }, 201);
    }
};

// ==========================================
// 2. Get My Rating for a Restaurant (User)
// ==========================================
export const getMyRating = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { restaurantId } = req.params;

    const [myRating] = await db.select().from(restaurantRatings)
        .where(and(
            eq(restaurantRatings.userId, userId),
            eq(restaurantRatings.restaurantId, restaurantId)
        )).limit(1);

    return SuccessResponse(res, {
        data: myRating || null
    });
};


export const getRestaurantRatings = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    if (!restaurantId) throw new BadRequest("restaurantId is required");

    const result = await db.select({
        avgRating: avg(restaurantRatings.rating).as("avg_rating"),
        totalRatings: count(restaurantRatings.id).as("total_ratings"),
    })
        .from(restaurantRatings)
        .where(eq(restaurantRatings.restaurantId, restaurantId))
        .limit(1);

    return SuccessResponse(res, {
        data: result[0]
    });
};

