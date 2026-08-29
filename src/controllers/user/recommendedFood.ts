import { Request, Response } from "express";
import { db } from "../../models/connection";
import { food, recommendedFoods, categories, subcategories } from "../../models/schema";
import { eq, and, asc, or, isNull } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { formatFoodsList } from "../../services/foodFormat";
import { getUserFavoritesSets } from "../../services/userFavoritesFood";

// ==========================================
// Get Recommended Foods for User (Storefront / App)
// ==========================================
export const getRecommendedFoodsForUser = async (req: Request, res: Response) => {
    const { foodId } = req.params;
    const userId = (req as any).user?.id;

    if (!foodId) {
        throw new BadRequest("foodId is required");
    }

    // 1. Check if the basic food item exists & get its restaurantId
    const [basicFood] = await db
        .select({
            id: food.id,
            restaurantId: food.restaurantid,
        })
        .from(food)
        .where(eq(food.id, foodId))
        .limit(1);

    if (!basicFood) {
        throw new NotFound("Food item not found");
    }

    // 2. Fetch active and available recommended products with category details for the formatter
    const rawRecommendations = await db
        .select({
            foodId: food.id,
            foodName: food.name,
            foodNameAr: food.nameAr,
            foodNameFr: food.nameFr,
            description: food.description,
            descriptionAr: food.descriptionAr,
            descriptionFr: food.descriptionFr,
            image: food.image,
            price: food.price,
            foodDiscountType: food.discount_type,
            foodDiscountValue: food.discount_value,
            isOutOfStock: food.isOutOfStock,
            points: food.points,
            addonsId: food.addonsId,

            categoryId: categories.id,
            categoryName: categories.name,
            categoryNameAr: categories.nameAr,
            categoryNameFr: categories.nameFr,

            subcategoryId: subcategories.id,
            subcategoryName: subcategories.name,
            subcategoryNameAr: subcategories.nameAr,
            subcategoryNameFr: subcategories.nameFr,
            order_level: subcategories.order_Level,
        })
        .from(recommendedFoods)
        .innerJoin(food, eq(recommendedFoods.recommendedFoodId, food.id))
        .leftJoin(categories, eq(food.categoryid, categories.id))
        .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
        .where(
            and(
                eq(recommendedFoods.foodId, foodId),
                eq(recommendedFoods.status, "active"),
                eq(food.status, "active"),
                // eq(food.isOutOfStock, false),
                // or(isNull(categories.id), eq(categories.status, "active")),
                // or(isNull(subcategories.id), eq(subcategories.status, "active"))
            )
        )
        .orderBy(asc(recommendedFoods.sortOrder));

    if (rawRecommendations.length === 0) {
        return SuccessResponse(res, {
            message: "Recommended products fetched successfully",
            data: [],
        });
    }

    // 3. Fetch user favorites if logged in
    const { favoriteFoodIds } = await getUserFavoritesSets(userId);

    // 4. Format recommendations using formatFoodsList service
    const formattedRecommendations = await formatFoodsList(
        rawRecommendations,
        basicFood.restaurantId,
        userId,
        favoriteFoodIds
    );

    return SuccessResponse(res, {
        message: "Recommended products fetched successfully",
        data: formattedRecommendations,
    });
};