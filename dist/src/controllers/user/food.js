"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFoodById = exports.getProductById = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const foodConditions_1 = require("../../helpers/foodConditions");
const foodFormat_1 = require("../../services/foodFormat");
const userFavoritesFood_1 = require("../../services/userFavoritesFood");
const pricing_helper_1 = require("../../helpers/pricing.helper");
// ==========================================
// User Food / Product Details Controller
// ==========================================
const getProductById = async (req, res) => {
    try {
        const { id: foodId } = req.params;
        const now = new Date();
        const userId = req.user?.id || req.user?._id;
        const branchIdParam = req.query?.branchId;
        const addressIdParam = req.query?.addressId;
        const serviceModuleParam = req.query?.serviceModule;
        // 1. Fetch raw food with category, subcategory, and restaurant
        const rawFoodRows = await connection_1.db
            .select({
            foodId: schema_1.food.id,
            foodName: schema_1.food.name,
            foodNameAr: schema_1.food.nameAr,
            foodNameFr: schema_1.food.nameFr,
            description: schema_1.food.description,
            descriptionAr: schema_1.food.descriptionAr,
            descriptionFr: schema_1.food.descriptionFr,
            price: schema_1.food.price,
            foodDiscountType: schema_1.food.discount_type,
            foodDiscountValue: schema_1.food.discount_value,
            isOutOfStock: schema_1.food.isOutOfStock,
            image: schema_1.food.image,
            points: schema_1.food.points,
            addonsId: schema_1.food.addonsId,
            restaurantId: schema_1.food.restaurantid,
            categoryId: schema_1.categories.id,
            categoryName: schema_1.categories.name,
            categoryNameAr: schema_1.categories.nameAr,
            categoryNameFr: schema_1.categories.nameFr,
            subcategoryId: schema_1.subcategories.id,
            subcategoryName: schema_1.subcategories.name,
            subcategoryNameAr: schema_1.subcategories.nameAr,
            subcategoryNameFr: schema_1.subcategories.nameFr,
            subcategoryImage: schema_1.subcategories.image,
            order_level: schema_1.subcategories.order_Level,
            restaurant: {
                id: schema_1.restaurants.id,
                name: schema_1.restaurants.name,
                nameAr: schema_1.restaurants.nameAr,
                nameFr: schema_1.restaurants.nameFr,
                logo: schema_1.restaurants.logo,
                cover: schema_1.restaurants.cover,
                address: schema_1.restaurants.address,
                addressAr: schema_1.restaurants.addressAr,
                addressFr: schema_1.restaurants.addressFr,
                minDeliveryTime: schema_1.restaurants.minDeliveryTime,
                maxDeliveryTime: schema_1.restaurants.maxDeliveryTime,
                deliveryTimeUnit: schema_1.restaurants.deliveryTimeUnit,
                callcenterphone: schema_1.restaurants.callcenterphone,
                status: schema_1.restaurants.status,
            },
        })
            .from(schema_1.food)
            .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
            .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
            .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.id, foodId), (0, drizzle_orm_1.eq)(schema_1.food.status, "active"), foodConditions_1.activeFoodCondition, (0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.categories.id), (0, drizzle_orm_1.eq)(schema_1.categories.status, "active")), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.subcategories.id), (0, drizzle_orm_1.eq)(schema_1.subcategories.status, "active"))))
            .limit(1);
        if (!rawFoodRows || rawFoodRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Product not found or currently unavailable",
            });
        }
        const rawFood = rawFoodRows[0];
        const restaurantId = rawFood.restaurantId;
        // 2. Resolve target branch and service module
        let targetBranchId = branchIdParam || null;
        let serviceModule = serviceModuleParam;
        if (branchIdParam) {
            if (!serviceModule)
                serviceModule = "takeaway";
        }
        else if (addressIdParam) {
            if (!serviceModule)
                serviceModule = "delivery";
            targetBranchId = await (0, pricing_helper_1.resolveBranchIdFromAddress)(addressIdParam, restaurantId);
        }
        const { favoriteFoodIds, favoriteRestaurantIds } = await (0, userFavoritesFood_1.getUserFavoritesSets)(userId);
        // 3. Check if there is an active discount on this food from discountFoods
        const [specificDiscount] = await connection_1.db
            .select({
            discountId: schema_1.discounts.id,
            discountName: schema_1.discounts.name,
            discountNameAr: schema_1.discounts.nameAr,
            discountNameFr: schema_1.discounts.nameFr,
            discountType: schema_1.discounts.discountType,
            discountValue: schema_1.discounts.discountValue,
            maxDiscount: schema_1.discounts.maxDiscount,
            minOrderAmount: schema_1.discounts.minOrderAmount,
            startDate: schema_1.discounts.startDate,
            endDate: schema_1.discounts.endDate,
            isGlobal: schema_1.discounts.isGlobal,
            logo: schema_1.discounts.logo,
        })
            .from(schema_1.discountFoods)
            .innerJoin(schema_1.discounts, (0, drizzle_orm_1.eq)(schema_1.discountFoods.discountId, schema_1.discounts.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discountFoods.foodId, foodId), (0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now))))
            .limit(1);
        // 4. Format food using formatFoodsList (handles variations, addons, pricing overrides, branch unavailability)
        const formattedFoods = await (0, foodFormat_1.formatFoodsList)([rawFood], restaurantId, userId, favoriteFoodIds, targetBranchId, serviceModule);
        if (!formattedFoods || formattedFoods.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Product is not available for the selected branch",
            });
        }
        const formattedFood = formattedFoods[0];
        // 5. Build discount details
        let discountDetails = null;
        let discountPrice = formattedFood.discountPrice;
        let discountType = formattedFood.discountType;
        let discountValue = formattedFood.discountValue;
        if (specificDiscount) {
            const val = specificDiscount.discountValue !== null ? Number(specificDiscount.discountValue) : null;
            const maxDisc = specificDiscount.maxDiscount !== null ? Number(specificDiscount.maxDiscount) : null;
            const minOrder = specificDiscount.minOrderAmount !== null ? Number(specificDiscount.minOrderAmount) : null;
            discountDetails = {
                id: specificDiscount.discountId,
                name: specificDiscount.discountName,
                nameAr: specificDiscount.discountNameAr ?? null,
                nameFr: specificDiscount.discountNameFr ?? null,
                type: specificDiscount.discountType,
                value: val,
                discountType: specificDiscount.discountType,
                discountValue: val,
                maxDiscount: maxDisc,
                minOrderAmount: minOrder,
                startDate: specificDiscount.startDate,
                endDate: specificDiscount.endDate,
                isGlobal: Boolean(specificDiscount.isGlobal),
                logo: specificDiscount.logo ?? null,
                source: specificDiscount.isGlobal ? "global_discount" : "food_discount",
            };
            // Calculate discount price if not already applied
            if (discountPrice === formattedFood.price || !discountPrice) {
                if (specificDiscount.discountType === "percentage" && val) {
                    let discountAmount = formattedFood.price * (val / 100);
                    if (maxDisc && maxDisc > 0) {
                        discountAmount = Math.min(discountAmount, maxDisc);
                    }
                    discountPrice = Math.max(0, formattedFood.price - discountAmount);
                    discountType = specificDiscount.discountType;
                    discountValue = val;
                }
                else if (["fixed_amount", "amount", "fixed"].includes(specificDiscount.discountType) && val) {
                    discountPrice = Math.max(0, formattedFood.price - val);
                    discountType = specificDiscount.discountType;
                    discountValue = val;
                }
            }
        }
        else if (formattedFood.discountDetails) {
            discountDetails = formattedFood.discountDetails;
        }
        const result = {
            ...formattedFood,
            discountPrice,
            discountType: discountType ?? discountDetails?.discountType ?? null,
            discountValue: discountValue ?? discountDetails?.discountValue ?? null,
            discountDetails,
            // discount: discountDetails,
        };
        return res.status(200).json({
            success: true,
            message: "Product details retrieved successfully",
            data: result,
        });
    }
    catch (error) {
        console.error("Error fetching product details by ID:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.getProductById = getProductById;
exports.getFoodById = exports.getProductById;
