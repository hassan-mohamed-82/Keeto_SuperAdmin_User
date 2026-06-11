"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRestaurantRatings = exports.getMyRating = exports.rateRestaurant = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const Errors_1 = require("../../Errors");
// ==========================================
// 1. Add or Update Rating (User)
// ==========================================
const rateRestaurant = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
        throw new Errors_1.UnauthorizedError("User not found");
    }
    const { restaurantId, rating, comment } = req.body;
    if (!restaurantId || !rating) {
        throw new BadRequest_1.BadRequest("restaurantId and rating are required");
    }
    if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        throw new BadRequest_1.BadRequest("Rating must be an integer between 1 and 5");
    }
    // تأكد المطعم موجود
    const [restaurant] = await connection_1.db.select().from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId)).limit(1);
    if (!restaurant)
        throw new NotFound_1.NotFound("Restaurant not found");
    // شوف لو اليوزر عامل rating قبل كده
    const [existing] = await connection_1.db.select().from(schema_1.restaurantRatings)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.userId, userId), (0, drizzle_orm_1.eq)(schema_1.restaurantRatings.restaurantId, restaurantId))).limit(1);
    if (existing) {
        // Update
        await connection_1.db.update(schema_1.restaurantRatings)
            .set({ rating, comment: comment || null, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.id, existing.id));
        return (0, response_1.SuccessResponse)(res, { message: "Rating updated successfully" });
    }
    else {
        // Insert
        await connection_1.db.insert(schema_1.restaurantRatings).values({
            userId,
            restaurantId,
            rating,
            comment: comment || null,
        });
        return (0, response_1.SuccessResponse)(res, { message: "Rating submitted successfully" }, 201);
    }
};
exports.rateRestaurant = rateRestaurant;
// ==========================================
// 2. Get My Rating for a Restaurant (User)
// ==========================================
const getMyRating = async (req, res) => {
    const userId = req.user?.id;
    const { restaurantId } = req.params;
    const [myRating] = await connection_1.db.select().from(schema_1.restaurantRatings)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.userId, userId), (0, drizzle_orm_1.eq)(schema_1.restaurantRatings.restaurantId, restaurantId))).limit(1);
    return (0, response_1.SuccessResponse)(res, {
        data: myRating || null
    });
};
exports.getMyRating = getMyRating;
const getRestaurantRatings = async (req, res) => {
    const { restaurantId } = req.params;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("restaurantId is required");
    const result = await connection_1.db.select({
        avgRating: (0, drizzle_orm_1.avg)(schema_1.restaurantRatings.rating).as("avg_rating"),
        totalRatings: (0, drizzle_orm_1.count)(schema_1.restaurantRatings.id).as("total_ratings"),
    })
        .from(schema_1.restaurantRatings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantRatings.restaurantId, restaurantId))
        .limit(1);
    return (0, response_1.SuccessResponse)(res, {
        data: result[0]
    });
};
exports.getRestaurantRatings = getRestaurantRatings;
