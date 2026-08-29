import { db } from "../models/connection";
import {
    foodVariations,
    variationOptions,
    addons,
    adonescategory,
    branchSubcategories,
    branches
} from "../models/schema";
import { eq, and, inArray } from "drizzle-orm";

import {
    getAvailableDiscounts,
    applyPriorityDiscount,
} from "../utils/discount";
import { getUnavailableBranchesForFoods } from "../helpers/food.helper";

export interface BranchInfo {
    id: string;
    name: string;
    nameAr?: string | null;
    nameFr?: string | null;
}

export const formatFoodsList = async (
    rawMenu: any[],
    restaurantId: string,
    userId?: string,
    favoriteFoodIds: Set<string> = new Set()
) => {
    if (!rawMenu || rawMenu.length === 0) return [];

    const foodIds = rawMenu.map(r => r.foodId || r.id);

    // 1. Fetch Variations & Options
    const variationsList = foodIds.length > 0
        ? await db
            .select({
                variationId: foodVariations.id,
                foodId: foodVariations.foodId,
                variationName: foodVariations.name,
                variationNameAr: foodVariations.nameAr,
                variationNameFr: foodVariations.nameFr,
                isRequired: foodVariations.isRequired,
                selectionType: foodVariations.selectionType,
                min: foodVariations.min,
                max: foodVariations.max,
                optionId: variationOptions.id,
                optionName: variationOptions.optionName,
                optionNameAr: variationOptions.optionNameAr,
                optionNameFr: variationOptions.optionNameFr,
                additionalPrice: variationOptions.additionalPrice,
            })
            .from(foodVariations)
            .leftJoin(variationOptions, eq(foodVariations.id, variationOptions.variationId))
            .where(inArray(foodVariations.foodId, foodIds))
        : [];

    const foodVariationsMap = new Map<string, any[]>();
    for (const v of variationsList) {
        if (!v.foodId) continue;
        if (!foodVariationsMap.has(v.foodId)) foodVariationsMap.set(v.foodId, []);

        const currentVars = foodVariationsMap.get(v.foodId)!;
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
    const rawAddons = await db
        .select({
            addonId: addons.id,
            addonName: addons.name,
            addonNameAr: addons.nameAr,
            addonNameFr: addons.nameFr,
            addonPrice: addons.price,
            addonStockType: addons.stock_type,
            addonStatus: addons.status,
            addonRestaurantId: addons.restaurantid,
            addonCreatedAt: addons.createdAt,
            addonUpdatedAt: addons.updatedAt,
            categoryId: adonescategory.id,
            categoryName: adonescategory.name,
            categoryNameAr: adonescategory.nameAr,
            categoryNameFr: adonescategory.nameFr,
        })
        .from(addons)
        .leftJoin(adonescategory, eq(addons.adonescategoryid, adonescategory.id))
        .where(
            and(
                eq(addons.restaurantid, restaurantId),
                eq(addons.status, "active")
            )
        );

    const addonsMap = new Map<string, any>();
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
        ? await getUnavailableBranchesForFoods(activeFoodIds)
        : new Map<string, BranchInfo[]>();

    const activeSubcategoryIds = [...new Set(
        rawMenu
            .filter(f => !f.isOutOfStock && f.subcategoryId)
            .map(f => f.subcategoryId!)
    )];

    const subcategoryUnavailableBranchesMap = new Map<string, BranchInfo[]>();
    if (activeSubcategoryIds.length > 0) {
        const inactiveSubcats = await db
            .select({
                subcategoryId: branchSubcategories.subcategoryId,
                branchId: branches.id,
                branchName: branches.name,
                branchNameAr: branches.nameAr,
                branchNameFr: branches.nameFr,
            })
            .from(branchSubcategories)
            .leftJoin(branches, eq(branchSubcategories.branchId, branches.id))
            .where(
                and(
                    inArray(branchSubcategories.subcategoryId, activeSubcategoryIds),
                    eq(branchSubcategories.status, "inactive")
                )
            );

        for (const row of inactiveSubcats) {
            if (!row.branchId) continue;
            if (!subcategoryUnavailableBranchesMap.has(row.subcategoryId)) {
                subcategoryUnavailableBranchesMap.set(row.subcategoryId, []);
            }
            subcategoryUnavailableBranchesMap.get(row.subcategoryId)!.push({
                id: row.branchId,
                name: row.branchName || "",
                nameAr: row.branchNameAr,
                nameFr: row.branchNameFr,
            });
        }
    }

    // 4. Calculate Discounts & Format Output
    const availableDiscounts = await getAvailableDiscounts(restaurantId);

    return rawMenu.map((row) => {
        const foodId = row.foodId || row.id;

        const discountState = {
            remainingMaxDiscounts: new Map<string, number>(),
            appliedDiscounts: new Set<string>()
        };

        const {
            price: calculatedDiscountPrice,
            appliedDiscount,
            discountNote
        } = applyPriorityDiscount(
            { id: foodId, discountType: row.foodDiscountType || row.discountType, discountValue: row.foodDiscountValue || row.discountValue },
            Number(row.price),
            0,
            availableDiscounts,
            discountState,
            false
        );

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
        } else if ((row.foodDiscountType || row.discountType) && Number(row.foodDiscountValue || row.discountValue) > 0) {
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
        let foodAddonIds: string[] = [];
        if (Array.isArray(row.addonsId)) {
            foodAddonIds = row.addonsId;
        } else if (row.addonsId) {
            const rawAddonsId = row.addonsId as any;
            if (typeof rawAddonsId === 'string') {
                try {
                    const parsed = JSON.parse(rawAddonsId);
                    foodAddonIds = Array.isArray(parsed) ? parsed : [parsed];
                } catch {
                    foodAddonIds = rawAddonsId.split(',').map((s: string) => s.trim());
                }
            }
        }

        const foodAddons = foodAddonIds
            .map(id => addonsMap.get(String(id).trim()))
            .filter(Boolean);

        // Branch Unavailability
        let unavailableBranches: BranchInfo[] | null = [];
        if (row.isOutOfStock) {
            unavailableBranches = null;
        } else {
            const foodUnavailable = menuUnavailableBranchesMap.get(foodId) || [];
            const subcatUnavailable = row.subcategoryId
                ? (subcategoryUnavailableBranchesMap.get(row.subcategoryId) || [])
                : [];

            const combinedBranches = new Map<string, BranchInfo>();
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