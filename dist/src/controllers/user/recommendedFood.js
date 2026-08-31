"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecommendedFoodsForUser = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const foodFormat_1 = require("../../services/foodFormat");
const userFavoritesFood_1 = require("../../services/userFavoritesFood");
// ==========================================
// Get Recommended Foods for User (Storefront / App)
// ==========================================
const getRecommendedFoodsForUser = async (req, res) => {
    const { foodId } = req.params;
    const userId = req.user?.id;
    if (!foodId) {
        throw new BadRequest_1.BadRequest("foodId is required");
    }
    // 1. Check if the basic food item exists & get its restaurantId
    const [basicFood] = await connection_1.db
        .select({
        id: schema_1.food.id,
        restaurantId: schema_1.food.restaurantid,
    })
        .from(schema_1.food)
        .where((0, drizzle_orm_1.eq)(schema_1.food.id, foodId))
        .limit(1);
    if (!basicFood) {
        throw new NotFound_1.NotFound("Food item not found");
    }
    // 2. Fetch active and available recommended products with category details for the formatter
    const rawRecommendations = await connection_1.db
        .select({
        foodId: schema_1.food.id,
        foodName: schema_1.food.name,
        foodNameAr: schema_1.food.nameAr,
        foodNameFr: schema_1.food.nameFr,
        description: schema_1.food.description,
        descriptionAr: schema_1.food.descriptionAr,
        descriptionFr: schema_1.food.descriptionFr,
        image: schema_1.food.image,
        price: schema_1.food.price,
        foodDiscountType: schema_1.food.discount_type,
        foodDiscountValue: schema_1.food.discount_value,
        isOutOfStock: schema_1.food.isOutOfStock,
        points: schema_1.food.points,
        addonsId: schema_1.food.addonsId,
        categoryId: schema_1.categories.id,
        categoryName: schema_1.categories.name,
        categoryNameAr: schema_1.categories.nameAr,
        categoryNameFr: schema_1.categories.nameFr,
        subcategoryId: schema_1.subcategories.id,
        subcategoryName: schema_1.subcategories.name,
        subcategoryNameAr: schema_1.subcategories.nameAr,
        subcategoryNameFr: schema_1.subcategories.nameFr,
        order_level: schema_1.subcategories.order_Level,
    })
        .from(schema_1.recommendedFoods)
        .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.recommendedFoods.recommendedFoodId, schema_1.food.id))
        .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
        .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.recommendedFoods.foodId, foodId), (0, drizzle_orm_1.eq)(schema_1.recommendedFoods.status, "active"), (0, drizzle_orm_1.eq)(schema_1.food.status, "active")))
        .orderBy((0, drizzle_orm_1.asc)(schema_1.recommendedFoods.sortOrder));
    if (rawRecommendations.length === 0) {
        return (0, response_1.SuccessResponse)(res, {
            message: "Recommended products fetched successfully",
            data: [],
        });
    }
    // 3. Fetch user favorites if logged in
    const { favoriteFoodIds } = await (0, userFavoritesFood_1.getUserFavoritesSets)(userId);
    // 4. Format recommendations using formatFoodsList service
    const formattedRecommendations = await (0, foodFormat_1.formatFoodsList)(rawRecommendations, basicFood.restaurantId, userId, favoriteFoodIds);
    return (0, response_1.SuccessResponse)(res, {
        message: "Recommended products fetched successfully",
        data: formattedRecommendations,
    });
};
exports.getRecommendedFoodsForUser = getRecommendedFoodsForUser;
