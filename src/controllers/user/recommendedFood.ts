import { Request, Response } from "express";
import { db } from "../../models/connection";
import { food, recommendedFoods } from "../../models/schema";
import { eq, and, asc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";

// ==========================================
// Get Recommended Foods for User (Storefront / App)
// ==========================================
export const getRecommendedFoodsForUser = async (req: Request, res: Response) => {
    const { foodId } = req.params;

    if (!foodId) {
        throw new BadRequest("foodId is required");
    }

    // 1. Check if the basic food item exists
    const [basicFood] = await db
        .select({
            id: food.id,
            name: food.name,
            nameAr: food.nameAr,
            nameFr: food.nameFr,
            restaurantId: food.restaurantid,
        })
        .from(food)
        .where(eq(food.id, foodId))
        .limit(1);

    if (!basicFood) {
        throw new NotFound("Food item not found");
    }

    // 2. Fetch active and available recommended products
    const recommendations = await db
        .select({
            id: food.id,
            name: food.name,
            nameAr: food.nameAr,
            nameFr: food.nameFr,
            description: food.description,
            descriptionAr: food.descriptionAr,
            descriptionFr: food.descriptionFr,
            image: food.image,
            price: food.price,
            discountType: food.discount_type,
            discountValue: food.discount_value,
            foodType: food.foodtype,
            isHalal: food.is_Halal,
            isOutOfStock: food.isOutOfStock,
            sortOrder: recommendedFoods.sortOrder,
        })
        .from(recommendedFoods)
        .innerJoin(food, eq(recommendedFoods.recommendedFoodId, food.id))
        .where(
            and(
                eq(recommendedFoods.foodId, foodId),
                eq(recommendedFoods.status, "active"),
                eq(food.status, "active"),
                eq(food.isOutOfStock, false)
            )
        )
        .orderBy(asc(recommendedFoods.sortOrder));

    return SuccessResponse(res, {
        message: "Recommended products fetched successfully",
        data: recommendations,
    });
};
