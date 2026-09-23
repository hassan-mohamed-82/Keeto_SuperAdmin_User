"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatFoodsList = void 0;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const discount_service_1 = require("./discount.service");
const food_helper_1 = require("../helpers/food.helper");
const pricing_overrides_1 = require("../helpers/pricing.overrides");
const formatFoodsList = async (rawMenu, restaurantId, userId, favoriteFoodIds = new Set(), targetBranchId, serviceModule) => {
    if (!rawMenu || rawMenu.length === 0)
        return [];
    const foodIds = rawMenu.map(r => r.foodId || r.id);
    // 1. Fetch Variations & Options
    const variationsList = foodIds.length > 0
        ? await connection_1.db
            .select({
            variationId: schema_1.foodVariations.id,
            foodId: schema_1.foodVariations.foodId,
            variationName: schema_1.foodVariations.name,
            variationNameAr: schema_1.foodVariations.nameAr,
            variationNameFr: schema_1.foodVariations.nameFr,
            isRequired: schema_1.foodVariations.isRequired,
            selectionType: schema_1.foodVariations.selectionType,
            min: schema_1.foodVariations.min,
            max: schema_1.foodVariations.max,
            optionId: schema_1.variationOptions.id,
            optionName: schema_1.variationOptions.optionName,
            optionNameAr: schema_1.variationOptions.optionNameAr,
            optionNameFr: schema_1.variationOptions.optionNameFr,
            additionalPrice: schema_1.variationOptions.additionalPrice,
        })
            .from(schema_1.foodVariations)
            .leftJoin(schema_1.variationOptions, (0, drizzle_orm_1.eq)(schema_1.foodVariations.id, schema_1.variationOptions.variationId))
            .where((0, drizzle_orm_1.inArray)(schema_1.foodVariations.foodId, foodIds))
        : [];
    // 1b. Fetch Food & Variant Pricing Overrides (Branch & Channel Pricing)
    const foodOverridesMap = new Map();
    const variantOverridesMap = new Map();
    if (foodIds.length > 0) {
        const foodCond = (0, pricing_overrides_1.cascadeOverrideCondition)(schema_1.foodPricingOverrides, targetBranchId, serviceModule);
        const conditions = [
            (0, drizzle_orm_1.inArray)(schema_1.foodPricingOverrides.foodId, foodIds),
            (0, drizzle_orm_1.eq)(schema_1.foodPricingOverrides.status, "active"),
        ];
        if (foodCond) {
            conditions.push(foodCond);
        }
        const overrides = await connection_1.db
            .select({
            foodId: schema_1.foodPricingOverrides.foodId,
            branchId: schema_1.foodPricingOverrides.branchId,
            serviceModule: schema_1.foodPricingOverrides.serviceModule,
            price: schema_1.foodPricingOverrides.price,
            status: schema_1.foodPricingOverrides.status,
        })
            .from(schema_1.foodPricingOverrides)
            .where((0, drizzle_orm_1.and)(...conditions));
        for (const ov of overrides) {
            if (!foodOverridesMap.has(ov.foodId)) {
                foodOverridesMap.set(ov.foodId, []);
            }
            foodOverridesMap.get(ov.foodId).push(ov);
        }
        const allOptionIds = variationsList
            .map((v) => v.optionId)
            .filter(Boolean);
        if (allOptionIds.length > 0) {
            const varCond = (0, pricing_overrides_1.cascadeOverrideCondition)(schema_1.variantPricingOverrides, targetBranchId, serviceModule);
            const varConditions = [
                (0, drizzle_orm_1.inArray)(schema_1.variantPricingOverrides.variantId, allOptionIds),
                (0, drizzle_orm_1.eq)(schema_1.variantPricingOverrides.status, "active"),
            ];
            if (varCond) {
                varConditions.push(varCond);
            }
            const varOverrides = await connection_1.db
                .select({
                variantId: schema_1.variantPricingOverrides.variantId,
                branchId: schema_1.variantPricingOverrides.branchId,
                serviceModule: schema_1.variantPricingOverrides.serviceModule,
                price: schema_1.variantPricingOverrides.price,
                status: schema_1.variantPricingOverrides.status,
            })
                .from(schema_1.variantPricingOverrides)
                .where((0, drizzle_orm_1.and)(...varConditions));
            for (const ov of varOverrides) {
                if (!variantOverridesMap.has(ov.variantId)) {
                    variantOverridesMap.set(ov.variantId, []);
                }
                variantOverridesMap.get(ov.variantId).push(ov);
            }
        }
    }
    const foodVariationsMap = new Map();
    for (const v of variationsList) {
        if (!v.foodId)
            continue;
        if (!foodVariationsMap.has(v.foodId))
            foodVariationsMap.set(v.foodId, []);
        const currentVars = foodVariationsMap.get(v.foodId);
        let existingVar = currentVars.find(x => x.id === v.variationId);
        if (!existingVar) {
            existingVar = {
                id: v.variationId,
                name: v.variationName,
                nameAr: v.variationNameAr,
                nameFr: v.variationNameFr,
                isRequired: v.isRequired,
                selectionType: v.selectionType,
                min: v.min,
                max: v.max,
                options: []
            };
            currentVars.push(existingVar);
        }
        if (v.optionId) {
            let optionPrice = Number(v.additionalPrice);
            if (variantOverridesMap.has(v.optionId)) {
                const bestVarOverride = (0, pricing_overrides_1.pickBestOverride)(variantOverridesMap.get(v.optionId));
                if (bestVarOverride) {
                    optionPrice = (0, pricing_overrides_1.parsePrice)(bestVarOverride.price);
                }
            }
            existingVar.options.push({
                id: v.optionId,
                name: v.optionName,
                nameAr: v.optionNameAr,
                nameFr: v.optionNameFr,
                additionalPrice: optionPrice
            });
        }
    }
    // 2. Fetch Active Addons
    const rawAddons = await connection_1.db
        .select({
        addonId: schema_1.addons.id,
        addonName: schema_1.addons.name,
        addonNameAr: schema_1.addons.nameAr,
        addonNameFr: schema_1.addons.nameFr,
        addonPrice: schema_1.addons.price,
        addonStockType: schema_1.addons.stock_type,
        addonStatus: schema_1.addons.status,
        addonRestaurantId: schema_1.addons.restaurantid,
        addonCreatedAt: schema_1.addons.createdAt,
        addonUpdatedAt: schema_1.addons.updatedAt,
        categoryId: schema_1.adonescategory.id,
        categoryName: schema_1.adonescategory.name,
        categoryNameAr: schema_1.adonescategory.nameAr,
        categoryNameFr: schema_1.adonescategory.nameFr,
    })
        .from(schema_1.addons)
        .leftJoin(schema_1.adonescategory, (0, drizzle_orm_1.eq)(schema_1.addons.adonescategoryid, schema_1.adonescategory.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addons.restaurantid, restaurantId), (0, drizzle_orm_1.eq)(schema_1.addons.status, "active")));
    const addonsMap = new Map();
    for (const a of rawAddons) {
        addonsMap.set(a.addonId, {
            id: a.addonId,
            name: a.addonName,
            nameAr: a.addonNameAr,
            nameFr: a.addonNameFr,
            price: Number(a.addonPrice),
            status: a.addonStatus,
            stockType: a.addonStockType,
            restaurantId: a.addonRestaurantId,
            createdAt: a.addonCreatedAt,
            updatedAt: a.addonUpdatedAt,
            category: a.categoryId ? {
                id: a.categoryId,
                name: a.categoryName,
                nameAr: a.categoryNameAr,
                nameFr: a.categoryNameFr
            } : null
        });
    }
    // 3. Branch Unavailability Logic
    const activeFoodIds = rawMenu.filter(f => !f.isOutOfStock).map(f => f.foodId || f.id);
    const menuUnavailableBranchesMap = activeFoodIds.length > 0
        ? await (0, food_helper_1.getUnavailableBranchesForFoods)(activeFoodIds)
        : new Map();
    const activeSubcategoryIds = [...new Set(rawMenu
            .filter(f => !f.isOutOfStock && f.subcategoryId)
            .map(f => f.subcategoryId))];
    const subcategoryUnavailableBranchesMap = new Map();
    if (activeSubcategoryIds.length > 0) {
        const inactiveSubcats = await connection_1.db
            .select({
            subcategoryId: schema_1.branchSubcategories.subcategoryId,
            branchId: schema_1.branches.id,
            branchName: schema_1.branches.name,
            branchNameAr: schema_1.branches.nameAr,
            branchNameFr: schema_1.branches.nameFr,
        })
            .from(schema_1.branchSubcategories)
            .leftJoin(schema_1.branches, (0, drizzle_orm_1.eq)(schema_1.branchSubcategories.branchId, schema_1.branches.id))
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.inArray)(schema_1.branchSubcategories.subcategoryId, activeSubcategoryIds), (0, drizzle_orm_1.eq)(schema_1.branchSubcategories.status, "inactive")));
        for (const row of inactiveSubcats) {
            if (!row.branchId)
                continue;
            if (!subcategoryUnavailableBranchesMap.has(row.subcategoryId)) {
                subcategoryUnavailableBranchesMap.set(row.subcategoryId, []);
            }
            subcategoryUnavailableBranchesMap.get(row.subcategoryId).push({
                id: row.branchId,
                name: row.branchName || "",
                nameAr: row.branchNameAr,
                nameFr: row.branchNameFr,
            });
        }
    }
    // 4. Calculate discounts through the shared product resolver.
    const productsWithDiscounts = await (0, discount_service_1.formatProductsWithDiscounts)(rawMenu, restaurantId);
    return productsWithDiscounts.map((row) => {
        const foodId = row.foodId || row.id;
        let effectiveFoodPrice = Number(row.price);
        if (foodOverridesMap.has(foodId)) {
            const bestFoodOverride = (0, pricing_overrides_1.pickBestOverride)(foodOverridesMap.get(foodId));
            if (bestFoodOverride) {
                effectiveFoodPrice = (0, pricing_overrides_1.parsePrice)(bestFoodOverride.price);
            }
        }
        const calculatedDiscountPrice = row.finalPrice;
        const discountNote = row.discountNote;
        // Parse Addons IDs
        let foodAddonIds = [];
        if (Array.isArray(row.addonsId)) {
            foodAddonIds = row.addonsId;
        }
        else if (row.addonsId) {
            const rawAddonsId = row.addonsId;
            if (typeof rawAddonsId === 'string') {
                try {
                    const parsed = JSON.parse(rawAddonsId);
                    foodAddonIds = Array.isArray(parsed) ? parsed : [parsed];
                }
                catch {
                    foodAddonIds = rawAddonsId.split(',').map((s) => s.trim());
                }
            }
        }
        const foodAddons = foodAddonIds
            .map(id => addonsMap.get(String(id).trim()))
            .filter(Boolean);
        // Branch Unavailability
        let unavailableBranches = [];
        if (row.isOutOfStock) {
            unavailableBranches = null;
        }
        else {
            const foodUnavailable = menuUnavailableBranchesMap.get(foodId) || [];
            const subcatUnavailable = row.subcategoryId
                ? (subcategoryUnavailableBranchesMap.get(row.subcategoryId) || [])
                : [];
            const combinedBranches = new Map();
            [...foodUnavailable, ...subcatUnavailable].forEach(b => combinedBranches.set(b.id, b));
            unavailableBranches = Array.from(combinedBranches.values());
        }
        // If a specific branch was requested, skip foods that are unavailable there
        if (targetBranchId && (0, food_helper_1.isFoodUnavailableForBranch)(unavailableBranches, targetBranchId)) {
            return null; // will be filtered out below
        }
        return {
            id: foodId,
            name: row.foodName || row.name,
            nameAr: row.foodNameAr || row.nameAr,
            nameFr: row.foodNameFr || row.nameFr,
            description: row.description,
            descriptionAr: row.descriptionAr,
            descriptionFr: row.descriptionFr,
            price: effectiveFoodPrice,
            originalPrice: row.originalPrice,
            finalPrice: row.finalPrice,
            discountAmount: row.discountAmount,
            appliedDiscountId: row.appliedDiscountId,
            discountSource: row.discountSource,
            discountType: row.discountDetails?.type ?? null,
            discountValue: row.discountDetails?.value ?? null,
            discountPrice: calculatedDiscountPrice,
            discountNote,
            discountDetails: row.discountDetails,
            image: row.image,
            isOutOfStock: row.isOutOfStock,
            points: userId ? (row.points ?? 0) : null,
            isFavorite: userId ? favoriteFoodIds.has(foodId) : false,
            variations: foodVariationsMap.get(foodId) || [],
            addons: foodAddons,
            unavailableBranches,
            category: row.categoryId ? {
                id: row.categoryId,
                name: row.categoryName,
                nameAr: row.categoryNameAr,
                nameFr: row.categoryNameFr,
            } : null,
            subcategory: row.subcategoryId ? {
                id: row.subcategoryId,
                name: row.subcategoryName,
                nameAr: row.subcategoryNameAr,
                nameFr: row.subcategoryNameFr,
                image: row.subcategoryImage || row.subcategoryimage || row.subcategory_image || null,
                order_level: row.order_level,
            } : null,
        };
    }).filter(Boolean);
};
exports.formatFoodsList = formatFoodsList;
