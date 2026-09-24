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
const attachDiscountDetails = (item) => {
    const details = item.discountDetails;
    return {
        ...item,
        discountPrice: item.discountPrice ?? item.finalPrice ?? item.price,
        discountType: item.discountType ?? details?.type ?? null,
        discountValue: item.discountValue ?? (details?.value !== undefined ? details.value : null),
        discountId: item.appliedDiscountId ?? details?.id ?? null,
        discountName: details?.name ?? (item.discountSource === "product" ? "Product discount" : null),
        discountNameAr: details?.nameAr ?? null,
        discountNameFr: details?.nameFr ?? null,
        isGlobal: details?.isGlobal ?? false,
        discountLogo: details?.logo ?? null,
        discountDetails: details ?? null,
        discount: details ?? null,
    };
};
// ==========================================
// 1. GET Restaurant Offers (Flat list of active foods with offers)
// ==========================================
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
            discountId: schema_1.food.discountId, // groupId — crucial for discount.service
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
        })
            .from(schema_1.food)
            .leftJoin(schema_1.discountGroups, (0, drizzle_orm_1.eq)(schema_1.food.discountId, schema_1.discountGroups.id))
            .leftJoin(schema_1.discounts, (0, drizzle_orm_1.eq)(schema_1.discountGroups.discountId, schema_1.discounts.id))
            .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
            .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId), (0, drizzle_orm_1.eq)(schema_1.food.status, "active"), foodConditions_1.activeFoodCondition, (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.categories.id), (0, drizzle_orm_1.eq)(schema_1.categories.status, "active")), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.subcategories.id), (0, drizzle_orm_1.eq)(schema_1.subcategories.status, "active")), 
        // Only restaurant/campaign discounts — no direct product discounts
        (0, drizzle_orm_1.and)((0, drizzle_orm_1.isNotNull)(schema_1.food.discountId), (0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.usageLimit), (0, drizzle_orm_1.sql) `${schema_1.discounts.usedCount} < ${schema_1.discounts.usageLimit}`))));
        if (offersData.length === 0) {
            return res.status(200).json({
                success: true,
                message: "Restaurant offers retrieved successfully",
                data: [],
            });
        }
        const formattedOffers = await (0, foodFormat_1.formatFoodsList)(offersData, restaurantId, userId, favoriteFoodIds, targetBranchId, serviceModule);
        // Only restaurant/global campaign discounts — product-level are excluded by the SQL query
        const formattedResults = formattedOffers
            .filter((item) => item.discountAmount > 0 &&
            (item.discountSource === "restaurant" || item.discountSource === "global"))
            .map(attachDiscountDetails);
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
// ==========================================
// 2. GET All Offers (Flat list across all active restaurants)
// ==========================================
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
            discountId: schema_1.food.discountId,
            foodDiscountType: schema_1.food.discount_type,
            foodDiscountValue: schema_1.food.discount_value,
            image: schema_1.food.image,
            points: schema_1.food.points,
            isOutOfStock: schema_1.food.isOutOfStock,
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
            },
        })
            .from(schema_1.food)
            .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
            .leftJoin(schema_1.discountGroups, (0, drizzle_orm_1.eq)(schema_1.food.discountId, schema_1.discountGroups.id))
            .leftJoin(schema_1.discounts, (0, drizzle_orm_1.eq)(schema_1.discountGroups.discountId, schema_1.discounts.id))
            .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
            .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"), (0, drizzle_orm_1.eq)(schema_1.food.status, "active"), foodConditions_1.activeFoodCondition, (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.categories.id), (0, drizzle_orm_1.eq)(schema_1.categories.status, "active")), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.subcategories.id), (0, drizzle_orm_1.eq)(schema_1.subcategories.status, "active")), (0, drizzle_orm_1.or)(
        // 1. Active campaign discount
        (0, drizzle_orm_1.and)((0, drizzle_orm_1.isNotNull)(schema_1.food.discountId), (0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.usageLimit), (0, drizzle_orm_1.sql) `${schema_1.discounts.usedCount} < ${schema_1.discounts.usageLimit}`)), 
        // 2. Direct product discount
        (0, drizzle_orm_1.and)((0, drizzle_orm_1.isNotNull)(schema_1.food.discount_type), (0, drizzle_orm_1.isNotNull)(schema_1.food.discount_value), (0, drizzle_orm_1.sql) `CAST(${schema_1.food.discount_value} AS DECIMAL(10,2)) > 0`))));
        if (globalOffers.length === 0) {
            return res.status(200).json({
                success: true,
                message: "All platform offers retrieved successfully",
                data: [],
            });
        }
        const offersByRestaurant = new Map();
        const restaurantMap = new Map();
        for (const row of globalOffers) {
            if (!offersByRestaurant.has(row.restaurantId)) {
                offersByRestaurant.set(row.restaurantId, []);
                restaurantMap.set(row.restaurantId, row.restaurant);
            }
            offersByRestaurant.get(row.restaurantId).push(row);
        }
        const formattedResults = [];
        for (const [rId, rFoods] of offersByRestaurant.entries()) {
            const formatted = await (0, foodFormat_1.formatFoodsList)(rFoods, rId, userId, favoriteFoodIds);
            for (const item of formatted) {
                if (item.discountAmount > 0 &&
                    (item.discountSource === "restaurant" || item.discountSource === "global")) {
                    const enrichedItem = attachDiscountDetails(item);
                    formattedResults.push({
                        ...enrichedItem,
                        restaurant: restaurantMap.get(rId) ?? null,
                    });
                }
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
// ==========================================
// 3. GET Discounts with Products (Campaigns grouping foods)
// ==========================================
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
        const nowConditions = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.discounts.isActive, true), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.startDate), (0, drizzle_orm_1.lte)(schema_1.discounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.endDate), (0, drizzle_orm_1.gte)(schema_1.discounts.endDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.discounts.usageLimit), (0, drizzle_orm_1.sql) `${schema_1.discounts.usedCount} < ${schema_1.discounts.usageLimit}`));
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
            const discountMap = new Map();
            [...restDiscounts, ...globalDiscounts].forEach((d) => {
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
        const activeDiscountIds = activeDiscountsRows.map((d) => d.id);
        const groups = await connection_1.db
            .select()
            .from(schema_1.discountGroups)
            .where((0, drizzle_orm_1.inArray)(schema_1.discountGroups.discountId, activeDiscountIds));
        if (groups.length === 0) {
            const result = activeDiscountsRows.map((d) => ({
                id: d.id,
                name: d.name,
                nameAr: d.nameAr,
                nameFr: d.nameFr,
                discountType: null,
                discountValue: null,
                maxDiscount: null,
                minOrderAmount: d.minOrderAmount !== null ? Number(d.minOrderAmount) : null,
                startDate: d.startDate,
                endDate: d.endDate,
                isGlobal: Boolean(d.isGlobal),
                logo: d.logo ?? null,
                source: d.isGlobal ? "global_discount" : "restaurant_discount",
                groups: [],
                foods: [],
            }));
            return res.status(200).json({
                success: true,
                message: "Discounts with products retrieved successfully",
                data: result,
            });
        }
        const groupToDiscountIdMap = new Map();
        const groupsByDiscountIdMap = new Map();
        const groupIds = [];
        for (const g of groups) {
            groupIds.push(g.id);
            groupToDiscountIdMap.set(g.id, g.discountId);
            if (!groupsByDiscountIdMap.has(g.discountId)) {
                groupsByDiscountIdMap.set(g.discountId, []);
            }
            groupsByDiscountIdMap.get(g.discountId).push(g);
        }
        const foodWhereConditions = [
            (0, drizzle_orm_1.inArray)(schema_1.food.discountId, groupIds),
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
            foodId: schema_1.food.id,
            foodName: schema_1.food.name,
            foodNameAr: schema_1.food.nameAr,
            foodNameFr: schema_1.food.nameFr,
            description: schema_1.food.description,
            descriptionAr: schema_1.food.descriptionAr,
            descriptionFr: schema_1.food.descriptionFr,
            price: schema_1.food.price,
            discountId: schema_1.food.discountId, // groupId
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
            .from(schema_1.food)
            .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
            .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
            .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
            .where((0, drizzle_orm_1.and)(...foodWhereConditions));
        const discountProductsMap = new Map();
        for (const row of productsRows) {
            const campaignId = row.discountId ? groupToDiscountIdMap.get(row.discountId) : null;
            if (!campaignId)
                continue;
            if (!discountProductsMap.has(campaignId)) {
                discountProductsMap.set(campaignId, new Map());
            }
            const restMap = discountProductsMap.get(campaignId);
            if (!restMap.has(row.restaurantId)) {
                restMap.set(row.restaurantId, []);
            }
            restMap.get(row.restaurantId).push(row);
        }
        const result = [];
        for (const d of activeDiscountsRows) {
            const dGroups = groupsByDiscountIdMap.get(d.id) || [];
            const primaryGroup = dGroups[0];
            const metaDiscountValue = primaryGroup?.discountValue !== null && primaryGroup?.discountValue !== undefined
                ? Number(primaryGroup.discountValue)
                : null;
            const metaMaxDiscount = primaryGroup?.maxDiscount !== null && primaryGroup?.maxDiscount !== undefined
                ? Number(primaryGroup.maxDiscount)
                : null;
            const restMap = discountProductsMap.get(d.id);
            const allProductsForDiscount = [];
            if (restMap) {
                for (const [rId, rows] of restMap.entries()) {
                    const formatted = await (0, foodFormat_1.formatFoodsList)(rows, rId, userId, favoriteFoodIds, targetBranchId, serviceModule);
                    for (const item of formatted) {
                        const enrichedItem = attachDiscountDetails(item);
                        allProductsForDiscount.push(enrichedItem);
                    }
                }
            }
            result.push({
                id: d.id,
                name: d.name,
                nameAr: d.nameAr,
                nameFr: d.nameFr,
                discountType: primaryGroup?.discountType ?? null,
                discountValue: metaDiscountValue,
                maxDiscount: metaMaxDiscount,
                minOrderAmount: d.minOrderAmount !== null ? Number(d.minOrderAmount) : null,
                startDate: d.startDate,
                endDate: d.endDate,
                isGlobal: Boolean(d.isGlobal),
                logo: d.logo ?? null,
                source: d.isGlobal ? "global_discount" : "restaurant_discount",
                groups: dGroups.map((g) => ({
                    id: g.id,
                    discountType: g.discountType,
                    discountValue: Number(g.discountValue),
                    maxDiscount: g.maxDiscount !== null ? Number(g.maxDiscount) : null,
                })),
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
