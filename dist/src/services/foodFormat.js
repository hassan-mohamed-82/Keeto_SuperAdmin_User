"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatFoodsList = void 0;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const discount_1 = require("../utils/discount");
const food_helper_1 = require("../helpers/food.helper");
const formatFoodsList = async (rawMenu, restaurantId, userId, favoriteFoodIds = new Set()) => {
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
            existingVar.options.push({
                id: v.optionId,
                name: v.optionName,
                nameAr: v.optionNameAr,
                nameFr: v.optionNameFr,
                additionalPrice: Number(v.additionalPrice)
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
    // 4. Calculate Discounts & Format Output
    const availableDiscounts = await (0, discount_1.getAvailableDiscounts)(restaurantId);
    return rawMenu.map((row) => {
        const foodId = row.foodId || row.id;
        const discountState = {
            remainingMaxDiscounts: new Map(),
            appliedDiscounts: new Set()
        };
        const { price: calculatedDiscountPrice, appliedDiscount, discountNote } = (0, discount_1.applyPriorityDiscount)({ id: foodId, discountType: row.foodDiscountType || row.discountType, discountValue: row.foodDiscountValue || row.discountValue }, Number(row.price), 0, availableDiscounts, discountState, false);
        let activeDiscountInfo = null;
        if (appliedDiscount && appliedDiscount.id) {
            activeDiscountInfo = {
                id: appliedDiscount.id,
                name: appliedDiscount.name,
                nameAr: appliedDiscount.nameAr,
                type: appliedDiscount.discountType,
                value: Number(appliedDiscount.discountValue),
                maxDiscount: appliedDiscount.maxDiscount ? Number(appliedDiscount.maxDiscount) : null,
                isGlobal: Boolean(appliedDiscount.isGlobal),
                source: appliedDiscount.isGlobal ? "global_discount" : "restaurant_discount"
            };
        }
        else if ((row.foodDiscountType || row.discountType) && Number(row.foodDiscountValue || row.discountValue) > 0) {
            activeDiscountInfo = {
                id: null,
                name: "Item Discount",
                nameAr: "خصم على الصنف",
                type: row.foodDiscountType || row.discountType,
                value: Number(row.foodDiscountValue || row.discountValue),
                maxDiscount: null,
                isGlobal: false,
                source: "food_level"
            };
        }
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
        return {
            id: foodId,
            name: row.foodName || row.name,
            nameAr: row.foodNameAr || row.nameAr,
            nameFr: row.foodNameFr || row.nameFr,
            description: row.description,
            descriptionAr: row.descriptionAr,
            descriptionFr: row.descriptionFr,
            price: Number(row.price),
            discountType: activeDiscountInfo?.type ?? null,
            discountValue: activeDiscountInfo?.value ?? null,
            discountPrice: calculatedDiscountPrice,
            discountNote,
            discountDetails: activeDiscountInfo,
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
                order_level: row.order_level,
            } : null,
        };
    });
};
exports.formatFoodsList = formatFoodsList;
