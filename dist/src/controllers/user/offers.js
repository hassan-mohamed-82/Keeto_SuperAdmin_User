"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllDiscountsWithProducts = exports.getAllOffers = exports.getRestaurantOffers = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const foodConditions_1 = require("../../helpers/foodConditions");
const foodFormat_1 = require("../../services/foodFormat");
const userFavoritesFood_1 = require("../../services/userFavoritesFood");
const pricing_helper_1 = require("../../helpers/pricing.helper");
const attachDiscountDetails = (item, meta) => {
    const discountDetails = meta
        ? {
            id: meta.discountId,
            name: meta.discountName,
            nameAr: meta.discountNameAr ?? null,
            nameFr: meta.discountNameFr ?? null,
            type: meta.discountType,
            value: meta.discountValue,
            discountType: meta.discountType,
            discountValue: meta.discountValue,
            maxDiscount: meta.maxDiscount,
            minOrderAmount: meta.minOrderAmount,
            startDate: meta.startDate,
            endDate: meta.endDate,
            isGlobal: meta.isGlobal,
            logo: meta.discountLogo,
            source: meta.isGlobal ? "global_discount" : "restaurant_discount",
        }
        : item.discountDetails ?? null;
    let discountPrice = item.discountPrice;
    let discountType = item.discountType;
    let discountValue = item.discountValue;
    // If formatFoodsList didn't calculate a discount price but meta discount exists
    if (meta && (discountPrice === item.price || discountPrice === null || discountPrice === undefined)) {
        if (meta.discountType === "percentage" && meta.discountValue) {
            let discountAmount = item.price * (meta.discountValue / 100);
            if (meta.maxDiscount && meta.maxDiscount > 0) {
                discountAmount = Math.min(discountAmount, meta.maxDiscount);
            }
            discountPrice = Math.max(0, item.price - discountAmount);
            discountType = meta.discountType;
            discountValue = meta.discountValue;
        }
        else if (["fixed_amount", "amount", "fixed"].includes(meta.discountType) && meta.discountValue) {
            discountPrice = Math.max(0, item.price - meta.discountValue);
            discountType = meta.discountType;
            discountValue = meta.discountValue;
        }
    }
    return {
        ...item,
        discountPrice,
        discountType: discountType ?? meta?.discountType ?? null,
        discountValue: discountValue ?? meta?.discountValue ?? null,
        discountId: meta?.discountId ?? item.discountDetails?.id ?? null,
        discountName: meta?.discountName ?? item.discountDetails?.name ?? null,
        discountNameAr: meta?.discountNameAr ?? item.discountDetails?.nameAr ?? null,
        discountNameFr: meta?.discountNameFr ?? null,
        isGlobal: meta ? meta.isGlobal : (item.discountDetails?.isGlobal ?? false),
        discountLogo: meta?.discountLogo ?? null,
        discountDetails,
        discount: discountDetails,
    };
};
const getRestaurantOffers = async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const now = new Date();
        const userId = req.user?.id || req.user?._id;
        const branchIdParam = req.query?.branchId;
        const addressIdParam = req.query?.addressId;
        const serviceModuleParam = req.query?.serviceModule;
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
        const { favoriteFoodIds } = await (0, userFavoritesFood_1.getUserFavoritesSets)(userId);
        const offersData = await connection_1.db
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
            // تفاصيل الخصم
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
        })
            .from(schema_1.discountFoods)
            .innerJoin(schema_1.discounts, (0, drizzle_orm_1.eq)(schema_1.discountFoods.discountId, schema_1.discounts.id))
            .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.discountFoods.foodId, schema_1.food.id))
            .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
            .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId), (0, drizzle_orm_1.eq)(schema_1.food.status, "active"), foodConditions_1.activeFoodCondition, (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.categories.id), (0, drizzle_orm_1.eq)(schema_1.categories.status, "active")), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.subcategories.id), (0, drizzle_orm_1.eq)(schema_1.subcategories.status, "active")), (0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now))));
        if (offersData.length === 0) {
            return res.status(200).json({
                success: true,
                message: "Restaurant offers retrieved successfully",
                data: [],
            });
        }
        const offerMetadataMap = new Map();
        for (const row of offersData) {
            offerMetadataMap.set(row.foodId, {
                discountId: row.discountId,
                discountName: row.discountName,
                discountNameAr: row.discountNameAr ?? null,
                discountNameFr: row.discountNameFr ?? null,
                discountType: row.discountType,
                discountValue: row.discountValue !== null ? Number(row.discountValue) : null,
                maxDiscount: row.maxDiscount !== null ? Number(row.maxDiscount) : null,
                minOrderAmount: row.minOrderAmount !== null ? Number(row.minOrderAmount) : null,
                startDate: row.startDate,
                endDate: row.endDate,
                isGlobal: Boolean(row.isGlobal),
                discountLogo: row.logo ?? null,
            });
        }
        const formattedOffers = await (0, foodFormat_1.formatFoodsList)(offersData, restaurantId, userId, favoriteFoodIds, targetBranchId, serviceModule);
        const formattedResults = formattedOffers.map((item) => {
            const meta = offerMetadataMap.get(item.id);
            return attachDiscountDetails(item, meta);
        });
        return res.status(200).json({
            success: true,
            message: "Restaurant offers retrieved successfully",
            data: formattedResults,
        });
    }
    catch (error) {
        console.error("Error fetching restaurant offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.getRestaurantOffers = getRestaurantOffers;
const getAllOffers = async (req, res) => {
    try {
        const now = new Date();
        const userId = req.user?.id || req.user?._id;
        const { favoriteFoodIds } = await (0, userFavoritesFood_1.getUserFavoritesSets)(userId);
        const globalOffers = await connection_1.db
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
            image: schema_1.food.image,
            points: schema_1.food.points,
            isOutOfStock: schema_1.food.isOutOfStock,
            addonsId: schema_1.food.addonsId,
            // تفاصيل الخصم
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
            restaurantId: schema_1.restaurants.id,
            // تفاصيل المطعم
            restaurant: {
                id: schema_1.restaurants.id,
                name: schema_1.restaurants.name,
                nameAr: schema_1.restaurants.nameAr,
                nameFr: schema_1.restaurants.nameFr,
                logo: schema_1.restaurants.logo,
                cover: schema_1.restaurants.cover,
                address: schema_1.restaurants.address,
                minDeliveryTime: schema_1.restaurants.minDeliveryTime,
                maxDeliveryTime: schema_1.restaurants.maxDeliveryTime,
                deliveryTimeUnit: schema_1.restaurants.deliveryTimeUnit,
            }
        })
            .from(schema_1.discountFoods)
            .innerJoin(schema_1.discounts, (0, drizzle_orm_1.eq)(schema_1.discountFoods.discountId, schema_1.discounts.id))
            .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.discountFoods.foodId, schema_1.food.id))
            .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
            .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
            .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), (0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"), (0, drizzle_orm_1.eq)(schema_1.food.status, "active"), foodConditions_1.activeFoodCondition, (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.categories.id), (0, drizzle_orm_1.eq)(schema_1.categories.status, "active")), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.subcategories.id), (0, drizzle_orm_1.eq)(schema_1.subcategories.status, "active")), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now))));
        if (globalOffers.length === 0) {
            return res.status(200).json({
                success: true,
                message: "All platform offers retrieved successfully",
                data: [],
            });
        }
        // Group foods by restaurant to run formatFoodsList per restaurant
        const offersByRestaurant = new Map();
        const offerMetadataMap = new Map();
        for (const row of globalOffers) {
            if (!offersByRestaurant.has(row.restaurantId)) {
                offersByRestaurant.set(row.restaurantId, []);
            }
            offersByRestaurant.get(row.restaurantId).push(row);
            offerMetadataMap.set(row.foodId, {
                discountId: row.discountId,
                discountName: row.discountName,
                discountNameAr: row.discountNameAr ?? null,
                discountNameFr: row.discountNameFr ?? null,
                discountType: row.discountType,
                discountValue: row.discountValue !== null ? Number(row.discountValue) : null,
                maxDiscount: row.maxDiscount !== null ? Number(row.maxDiscount) : null,
                minOrderAmount: row.minOrderAmount !== null ? Number(row.minOrderAmount) : null,
                startDate: row.startDate,
                endDate: row.endDate,
                isGlobal: Boolean(row.isGlobal),
                discountLogo: row.logo ?? null,
                restaurant: row.restaurant,
            });
        }
        const formattedResults = [];
        for (const [rId, rFoods] of offersByRestaurant.entries()) {
            const formatted = await (0, foodFormat_1.formatFoodsList)(rFoods, rId, userId, favoriteFoodIds);
            for (const item of formatted) {
                const meta = offerMetadataMap.get(item.id);
                const enrichedItem = attachDiscountDetails(item, meta);
                formattedResults.push({
                    ...enrichedItem,
                    restaurant: meta?.restaurant ?? null,
                });
            }
        }
        return res.status(200).json({
            success: true,
            message: "All platform offers retrieved successfully",
            data: formattedResults,
        });
    }
    catch (error) {
        console.error("Error fetching all offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.getAllOffers = getAllOffers;
const getAllDiscountsWithProducts = async (req, res) => {
    try {
        const now = new Date();
        const userId = req.user?.id || req.user?._id;
        const restaurantIdFilter = (req.params?.restaurantId || req.query?.restaurantId);
        const branchIdParam = req.query?.branchId;
        const addressIdParam = req.query?.addressId;
        const serviceModuleParam = req.query?.serviceModule;
        let targetBranchId = branchIdParam || null;
        let serviceModule = serviceModuleParam;
        if (branchIdParam) {
            if (!serviceModule)
                serviceModule = "takeaway";
        }
        else if (addressIdParam && restaurantIdFilter) {
            if (!serviceModule)
                serviceModule = "delivery";
            targetBranchId = await (0, pricing_helper_1.resolveBranchIdFromAddress)(addressIdParam, restaurantIdFilter);
        }
        const { favoriteFoodIds } = await (0, userFavoritesFood_1.getUserFavoritesSets)(userId);
        const nowConditions = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now)));
        let activeDiscountsRows = [];
        if (restaurantIdFilter) {
            const restDiscounts = await connection_1.db
                .select({ discount: schema_1.discounts })
                .from(schema_1.discounts)
                .innerJoin(schema_1.discountRestaurants, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountRestaurants.discountId))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discountRestaurants.restaurantId, restaurantIdFilter), nowConditions));
            const globalDiscounts = await connection_1.db
                .select({ discount: schema_1.discounts })
                .from(schema_1.discounts)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.isGlobal, true), nowConditions));
            const foodLinkedDiscounts = await connection_1.db
                .select({ discount: schema_1.discounts })
                .from(schema_1.discounts)
                .innerJoin(schema_1.discountFoods, (0, drizzle_orm_1.eq)(schema_1.discounts.id, schema_1.discountFoods.discountId))
                .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.discountFoods.foodId, schema_1.food.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantIdFilter), nowConditions));
            const discountMap = new Map();
            [...restDiscounts, ...globalDiscounts, ...foodLinkedDiscounts].forEach((d) => {
                if (!discountMap.has(d.discount.id)) {
                    discountMap.set(d.discount.id, d.discount);
                }
            });
            activeDiscountsRows = Array.from(discountMap.values());
        }
        else {
            activeDiscountsRows = await connection_1.db
                .select()
                .from(schema_1.discounts)
                .where(nowConditions);
        }
        if (activeDiscountsRows.length === 0) {
            return res.status(200).json({
                success: true,
                message: "Discounts with products retrieved successfully",
                data: [],
            });
        }
        const discountIds = activeDiscountsRows.map((d) => d.id);
        const foodWhereConditions = [
            (0, drizzle_orm_1.inArray)(schema_1.discountFoods.discountId, discountIds),
            (0, drizzle_orm_1.eq)(schema_1.food.status, "active"),
            (0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"),
            foodConditions_1.activeFoodCondition,
            (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.categories.id), (0, drizzle_orm_1.eq)(schema_1.categories.status, "active")),
            (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.subcategories.id), (0, drizzle_orm_1.eq)(schema_1.subcategories.status, "active")),
        ];
        if (restaurantIdFilter) {
            foodWhereConditions.push((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantIdFilter));
        }
        const productsRows = await connection_1.db
            .select({
            discountId: schema_1.discountFoods.discountId,
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
            restaurantId: schema_1.restaurants.id,
        })
            .from(schema_1.discountFoods)
            .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.discountFoods.foodId, schema_1.food.id))
            .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
            .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
            .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
            .where((0, drizzle_orm_1.and)(...foodWhereConditions));
        const discountProductsMap = new Map();
        for (const row of productsRows) {
            if (!discountProductsMap.has(row.discountId)) {
                discountProductsMap.set(row.discountId, new Map());
            }
            const restMap = discountProductsMap.get(row.discountId);
            if (!restMap.has(row.restaurantId)) {
                restMap.set(row.restaurantId, []);
            }
            restMap.get(row.restaurantId).push(row);
        }
        const result = [];
        for (const d of activeDiscountsRows) {
            const meta = {
                discountId: d.id,
                discountName: d.name,
                discountNameAr: d.nameAr ?? null,
                discountNameFr: d.nameFr ?? null,
                discountType: d.discountType,
                discountValue: d.discountValue !== null ? Number(d.discountValue) : null,
                maxDiscount: d.maxDiscount !== null ? Number(d.maxDiscount) : null,
                minOrderAmount: d.minOrderAmount !== null ? Number(d.minOrderAmount) : null,
                startDate: d.startDate,
                endDate: d.endDate,
                isGlobal: Boolean(d.isGlobal),
                discountLogo: d.logo ?? null,
            };
            const restMap = discountProductsMap.get(d.id);
            const allProductsForDiscount = [];
            if (restMap) {
                for (const [rId, rows] of restMap.entries()) {
                    const formatted = await (0, foodFormat_1.formatFoodsList)(rows, rId, userId, favoriteFoodIds, targetBranchId, serviceModule);
                    for (const item of formatted) {
                        let discountPrice = item.discountPrice;
                        if (meta.discountType === "percentage" && meta.discountValue) {
                            let discountAmount = item.price * (meta.discountValue / 100);
                            if (meta.maxDiscount && meta.maxDiscount > 0) {
                                discountAmount = Math.min(discountAmount, meta.maxDiscount);
                            }
                            discountPrice = Math.max(0, item.price - discountAmount);
                        }
                        else if (["fixed_amount", "amount", "fixed"].includes(meta.discountType) && meta.discountValue) {
                            discountPrice = Math.max(0, item.price - meta.discountValue);
                        }
                        const { discountDetails, discount, discountId, discountName, discountNameAr, discountNameFr, discountLogo, discountType, discountValue, isGlobal, restaurant, ...cleanItem } = item;
                        allProductsForDiscount.push({
                            ...cleanItem,
                            discountPrice,
                        });
                    }
                }
            }
            result.push({
                id: d.id,
                name: d.name,
                nameAr: d.nameAr,
                nameFr: d.nameFr,
                discountType: d.discountType,
                discountValue: meta.discountValue,
                maxDiscount: meta.maxDiscount,
                minOrderAmount: meta.minOrderAmount,
                startDate: d.startDate,
                endDate: d.endDate,
                isGlobal: Boolean(d.isGlobal),
                logo: d.logo ?? null,
                source: d.isGlobal ? "global_discount" : "restaurant_discount",
                foods: allProductsForDiscount,
            });
        }
        return res.status(200).json({
            success: true,
            message: "Discounts with products retrieved successfully",
            data: result,
        });
    }
    catch (error) {
        console.error("Error fetching discounts with products:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.getAllDiscountsWithProducts = getAllDiscountsWithProducts;
