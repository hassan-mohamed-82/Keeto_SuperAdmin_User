import { Request, Response } from "express";
import { eq, and, lte, gte, inArray } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    restaurants,
    offers,
    offerFoods,
    food,
    foodVariations,
    variationOptions,
} from "../../models/schema";
import { SuccessResponse } from "../../utils/response";

// ==========================================
// HELPERS
// ==========================================

const parseJsonArray = (val: any): any[] => {
    if (!val) return [];
    if (typeof val === "string") {
        try {
            const parsed = JSON.parse(val);
            return typeof parsed === "string" ? JSON.parse(parsed) : (Array.isArray(parsed) ? parsed : []);
        } catch {
            return [];
        }
    }
    return Array.isArray(val) ? val : [];
};

const getFoodVariationsMap = async (foodIds: string[]) => {
    const foodVariationsMap = new Map<string, any[]>();
    if (!foodIds.length) return foodVariationsMap;

    const variationsList = await db
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
        .where(inArray(foodVariations.foodId, foodIds));

    for (const v of variationsList) {
        if (!v.foodId) continue;
        if (!foodVariationsMap.has(v.foodId)) {
            foodVariationsMap.set(v.foodId, []);
        }

        const currentVars = foodVariationsMap.get(v.foodId)!;
        let existingVar = currentVars.find((x) => x.id === v.variationId);

        if (!existingVar) {
            existingVar = {
                id: v.variationId,
                name: v.variationName,
                nameAr: v.variationNameAr,
                nameFr: v.variationNameFr,
                isRequired: Boolean(v.isRequired),
                selectionType: v.selectionType,
                min: v.min,
                max: v.max,
                options: [],
            };
            currentVars.push(existingVar);
        }

        if (v.optionId) {
            existingVar.options.push({
                id: v.optionId,
                name: v.optionName,
                nameAr: v.optionNameAr,
                nameFr: v.optionNameFr,
                additionalPrice: Number(v.additionalPrice || 0),
            });
        }
    }

    return foodVariationsMap;
};

const formatBundleFoodItem = (row: any, foodVariationsMap: Map<string, any[]>) => {
    const rawOptionIds = parseJsonArray(row.optionIds);
    const rawVariations = parseJsonArray(row.variations);

    const selectedOptionIdSet = new Set<string>(rawOptionIds.map((id: any) => String(id)));
    for (const pv of rawVariations) {
        if (Array.isArray(pv?.options)) {
            pv.options.forEach((optId: any) => selectedOptionIdSet.add(String(optId)));
        }
    }

    const baseVariations = foodVariationsMap.get(row.foodId) || [];
    const formattedVariations = baseVariations
        .map((v) => {
            const selectedOptions = v.options.filter((opt: any) => selectedOptionIdSet.has(opt.id));
            if (selectedOptions.length === 0) return null;
            return {
                ...v,
                options: selectedOptions,
            };
        })
        .filter(Boolean);

    return {
        foodId: row.foodId,
        quantity: row.quantity,
        name: row.foodName,
        nameAr: row.foodNameAr,
        nameFr: row.foodNameFr || row.foodName,
        description: row.foodDescription || "",
        descriptionAr: row.foodDescriptionAr || "",
        image: row.foodImage,
        originalPrice: Number(row.foodPrice),
        isOutOfStock: Boolean(row.isOutOfStock),
        variations: formattedVariations,
    };
};

// ==========================================
// BUNDLE OFFERS — Retrieval Endpoints
// ==========================================

// ------------------------------------------
// 1. GET /bundles
//    List all active, non-expired bundle offers
// ------------------------------------------
export const getAllBundles = async (req: Request, res: Response) => {
    try {
        const now = new Date();
        const restaurantIdFilter = req.query?.restaurantId as string | undefined;

        const whereConditions = and(
            eq(offers.status, "active"),
            lte(offers.startDate, now),
            gte(offers.endDate, now),
            restaurantIdFilter ? eq(offers.restaurantId, restaurantIdFilter) : undefined
        );

        const offersRows = await db
            .select({
                id: offers.id,
                name: offers.name,
                image: offers.image,
                price: offers.price,
                startDate: offers.startDate,
                endDate: offers.endDate,
                restaurantId: offers.restaurantId,
                restaurantName: restaurants.name,
                restaurantNameAr: restaurants.nameAr,
                restaurantNameFr: restaurants.nameFr,
                restaurantLogo: restaurants.logo,
                restaurantCover: restaurants.cover,
            })
            .from(offers)
            .leftJoin(restaurants, eq(offers.restaurantId, restaurants.id))
            .where(whereConditions);

        // For each offer, load its foods
        const offerIds = offersRows.map((o) => o.id);
        const offerFoodsMap = new Map<string, any[]>();

        if (offerIds.length > 0) {
            const offerFoodRows = await db
                .select({
                    offerId: offerFoods.offerId,
                    foodId: offerFoods.foodId,
                    quantity: offerFoods.quantity,
                    variations: offerFoods.variations,
                    optionIds: offerFoods.optionIds,
                    foodName: food.name,
                    foodNameAr: food.nameAr,
                    foodNameFr: food.nameFr,
                    foodDescription: food.description,
                    foodDescriptionAr: food.descriptionAr,
                    foodImage: food.image,
                    foodPrice: food.price,
                    isOutOfStock: food.isOutOfStock,
                })
                .from(offerFoods)
                .innerJoin(food, eq(offerFoods.foodId, food.id))
                .where(inArray(offerFoods.offerId, offerIds));

            const uniqueFoodIds = [...new Set(offerFoodRows.map((f) => f.foodId))];
            const foodVariationsMap = await getFoodVariationsMap(uniqueFoodIds);

            for (const row of offerFoodRows) {
                if (!offerFoodsMap.has(row.offerId)) {
                    offerFoodsMap.set(row.offerId, []);
                }
                offerFoodsMap.get(row.offerId)!.push(formatBundleFoodItem(row, foodVariationsMap));
            }
        }

        const result = offersRows.map((o) => ({
            id: o.id,
            name: o.name,
            image: o.image,
            price: Number(o.price),
            startDate: o.startDate,
            endDate: o.endDate,
            restaurant: o.restaurantId
                ? {
                      id: o.restaurantId,
                      name: o.restaurantName,
                      nameAr: o.restaurantNameAr,
                      nameFr: o.restaurantNameFr,
                      logo: o.restaurantLogo,
                      cover: o.restaurantCover,
                  }
                : null,
            foods: offerFoodsMap.get(o.id) ?? [],
        }));

        return SuccessResponse(res, {
            message: "Bundle offers retrieved successfully",
            data: result,
        });
    } catch (error) {
        console.error("Error fetching bundle offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// ------------------------------------------
// 2. GET /bundles/:id
//    Single bundle details
// ------------------------------------------
export const getBundleById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const now = new Date();

        const [offerRow] = await db
            .select({
                id: offers.id,
                name: offers.name,
                image: offers.image,
                price: offers.price,
                startDate: offers.startDate,
                endDate: offers.endDate,
                status: offers.status,
                restaurantId: offers.restaurantId,
                restaurantName: restaurants.name,
                restaurantNameAr: restaurants.nameAr,
                restaurantNameFr: restaurants.nameFr,
                restaurantLogo: restaurants.logo,
                restaurantCover: restaurants.cover,
            })
            .from(offers)
            .leftJoin(restaurants, eq(offers.restaurantId, restaurants.id))
            .where(eq(offers.id, id))
            .limit(1);

        if (!offerRow) {
            return res.status(404).json({ success: false, message: "Offer not found" });
        }

        if (offerRow.status !== "active") {
            return res.status(404).json({ success: false, message: "This offer is no longer active" });
        }

        if (new Date(offerRow.endDate) < now) {
            return res.status(404).json({ success: false, message: "This offer has expired" });
        }

        const offerFoodRows = await db
            .select({
                foodId: offerFoods.foodId,
                quantity: offerFoods.quantity,
                variations: offerFoods.variations,
                optionIds: offerFoods.optionIds,
                foodName: food.name,
                foodNameAr: food.nameAr,
                foodNameFr: food.nameFr,
                foodDescription: food.description,
                foodDescriptionAr: food.descriptionAr,
                foodImage: food.image,
                foodPrice: food.price,
                isOutOfStock: food.isOutOfStock,
            })
            .from(offerFoods)
            .innerJoin(food, eq(offerFoods.foodId, food.id))
            .where(eq(offerFoods.offerId, id));

        const uniqueFoodIds = [...new Set(offerFoodRows.map((f) => f.foodId))];
        const foodVariationsMap = await getFoodVariationsMap(uniqueFoodIds);

        const foods = offerFoodRows.map((f) => formatBundleFoodItem(f, foodVariationsMap));

        return SuccessResponse(res, {
            message: "Offer details retrieved successfully",
            data: {
                id: offerRow.id,
                name: offerRow.name,
                image: offerRow.image,
                price: Number(offerRow.price),
                startDate: offerRow.startDate,
                endDate: offerRow.endDate,
                restaurant: offerRow.restaurantId
                    ? {
                          id: offerRow.restaurantId,
                          name: offerRow.restaurantName,
                          nameAr: offerRow.restaurantNameAr,
                          nameFr: offerRow.restaurantNameFr,
                          logo: offerRow.restaurantLogo,
                          cover: offerRow.restaurantCover,
                      }
                    : null,
                foods,
            },
        });
    } catch (error) {
        console.error("Error fetching bundle by ID:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};