"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBundleById = exports.getAllBundles = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const response_1 = require("../../utils/response");
// ==========================================
// HELPERS
// ==========================================
const parseJsonArray = (val) => {
    if (!val)
        return [];
    if (typeof val === "string") {
        try {
            const parsed = JSON.parse(val);
            return typeof parsed === "string" ? JSON.parse(parsed) : (Array.isArray(parsed) ? parsed : []);
        }
        catch {
            return [];
        }
    }
    return Array.isArray(val) ? val : [];
};
const getFoodVariationsMap = async (foodIds) => {
    const foodVariationsMap = new Map();
    if (!foodIds.length)
        return foodVariationsMap;
    const variationsList = await connection_1.db
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
        .leftJoin(schema_1.variationOptions, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.foodVariations.id, schema_1.variationOptions.variationId), (0, drizzle_orm_1.eq)(schema_1.variationOptions.status, true)))
        .where((0, drizzle_orm_1.inArray)(schema_1.foodVariations.foodId, foodIds));
    for (const v of variationsList) {
        if (!v.foodId)
            continue;
        if (!foodVariationsMap.has(v.foodId)) {
            foodVariationsMap.set(v.foodId, []);
        }
        const currentVars = foodVariationsMap.get(v.foodId);
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
const getAddonsMap = async (addonIds) => {
    const addonsMap = new Map();
    if (!addonIds.length)
        return addonsMap;
    const addonsList = await connection_1.db
        .select({
        id: schema_1.addons.id,
        name: schema_1.addons.name,
        nameAr: schema_1.addons.nameAr,
        nameFr: schema_1.addons.nameFr,
    })
        .from(schema_1.addons)
        .where((0, drizzle_orm_1.inArray)(schema_1.addons.id, addonIds));
    for (const a of addonsList) {
        addonsMap.set(a.id, {
            id: a.id,
            name: a.name,
            nameAr: a.nameAr,
            nameFr: a.nameFr,
        });
    }
    return addonsMap;
};
const formatBundleFoodItem = (row, foodVariationsMap, addonsMap) => {
    const rawOptionIds = parseJsonArray(row.optionIds);
    const rawVariations = parseJsonArray(row.variations);
    const rawAddonIds = parseJsonArray(row.addonIds);
    const selectedOptionIdSet = new Set(rawOptionIds.map((id) => String(id)));
    for (const pv of rawVariations) {
        if (Array.isArray(pv?.options)) {
            pv.options.forEach((optId) => selectedOptionIdSet.add(String(optId)));
        }
    }
    const baseVariations = foodVariationsMap.get(row.foodId) || [];
    const formattedVariations = baseVariations
        .map((v) => {
        const selectedOptions = v.options.filter((opt) => selectedOptionIdSet.has(opt.id));
        if (selectedOptions.length === 0)
            return null;
        return {
            ...v,
            options: selectedOptions,
        };
    })
        .filter(Boolean);
    const formattedAddons = rawAddonIds
        .map((id) => addonsMap.get(String(id)))
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
        addons: formattedAddons,
    };
};
// ==========================================
// BUNDLE OFFERS — Retrieval Endpoints
// ==========================================
// ------------------------------------------
// 1. GET /bundles
//    List all active, non-expired bundle offers
// ------------------------------------------
const getAllBundles = async (req, res) => {
    try {
        const now = new Date();
        const restaurantIdFilter = req.query?.restaurantId;
        const whereConditions = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.offers.status, "active"), (0, drizzle_orm_1.lte)(schema_1.offers.startDate, now), (0, drizzle_orm_1.gte)(schema_1.offers.endDate, now), restaurantIdFilter ? (0, drizzle_orm_1.eq)(schema_1.offers.restaurantId, restaurantIdFilter) : undefined);
        const offersRows = await connection_1.db
            .select({
            id: schema_1.offers.id,
            name: schema_1.offers.name,
            image: schema_1.offers.image,
            price: schema_1.offers.price,
            startDate: schema_1.offers.startDate,
            endDate: schema_1.offers.endDate,
            restaurantId: schema_1.offers.restaurantId,
            restaurantName: schema_1.restaurants.name,
            restaurantNameAr: schema_1.restaurants.nameAr,
            restaurantNameFr: schema_1.restaurants.nameFr,
            restaurantLogo: schema_1.restaurants.logo,
            restaurantCover: schema_1.restaurants.cover,
        })
            .from(schema_1.offers)
            .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.offers.restaurantId, schema_1.restaurants.id))
            .where(whereConditions);
        // For each offer, load its foods
        const offerIds = offersRows.map((o) => o.id);
        const offerFoodsMap = new Map();
        if (offerIds.length > 0) {
            const offerFoodRows = await connection_1.db
                .select({
                offerId: schema_1.offerFoods.offerId,
                foodId: schema_1.offerFoods.foodId,
                quantity: schema_1.offerFoods.quantity,
                variations: schema_1.offerFoods.variations,
                optionIds: schema_1.offerFoods.optionIds,
                addonIds: schema_1.offerFoods.addonIds,
                foodName: schema_1.food.name,
                foodNameAr: schema_1.food.nameAr,
                foodNameFr: schema_1.food.nameFr,
                foodDescription: schema_1.food.description,
                foodDescriptionAr: schema_1.food.descriptionAr,
                foodImage: schema_1.food.image,
                foodPrice: schema_1.food.price,
                isOutOfStock: schema_1.food.isOutOfStock,
            })
                .from(schema_1.offerFoods)
                .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.offerFoods.foodId, schema_1.food.id))
                .where((0, drizzle_orm_1.inArray)(schema_1.offerFoods.offerId, offerIds));
            const uniqueFoodIds = [...new Set(offerFoodRows.map((f) => f.foodId))];
            const foodVariationsMap = await getFoodVariationsMap(uniqueFoodIds);
            const allAddonIds = [
                ...new Set(offerFoodRows.flatMap((r) => parseJsonArray(r.addonIds).map((id) => String(id)).filter(Boolean))),
            ];
            const addonsMap = await getAddonsMap(allAddonIds);
            for (const row of offerFoodRows) {
                if (!offerFoodsMap.has(row.offerId)) {
                    offerFoodsMap.set(row.offerId, []);
                }
                offerFoodsMap.get(row.offerId).push(formatBundleFoodItem(row, foodVariationsMap, addonsMap));
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
        return (0, response_1.SuccessResponse)(res, {
            message: "Bundle offers retrieved successfully",
            data: result,
        });
    }
    catch (error) {
        console.error("Error fetching bundle offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.getAllBundles = getAllBundles;
// ------------------------------------------
// 2. GET /bundles/:id
//    Single bundle details
// ------------------------------------------
const getBundleById = async (req, res) => {
    try {
        const { id } = req.params;
        const now = new Date();
        const [offerRow] = await connection_1.db
            .select({
            id: schema_1.offers.id,
            name: schema_1.offers.name,
            image: schema_1.offers.image,
            price: schema_1.offers.price,
            startDate: schema_1.offers.startDate,
            endDate: schema_1.offers.endDate,
            status: schema_1.offers.status,
            restaurantId: schema_1.offers.restaurantId,
            restaurantName: schema_1.restaurants.name,
            restaurantNameAr: schema_1.restaurants.nameAr,
            restaurantNameFr: schema_1.restaurants.nameFr,
            restaurantLogo: schema_1.restaurants.logo,
            restaurantCover: schema_1.restaurants.cover,
        })
            .from(schema_1.offers)
            .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.offers.restaurantId, schema_1.restaurants.id))
            .where((0, drizzle_orm_1.eq)(schema_1.offers.id, id))
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
        const offerFoodRows = await connection_1.db
            .select({
            foodId: schema_1.offerFoods.foodId,
            quantity: schema_1.offerFoods.quantity,
            variations: schema_1.offerFoods.variations,
            optionIds: schema_1.offerFoods.optionIds,
            addonIds: schema_1.offerFoods.addonIds,
            foodName: schema_1.food.name,
            foodNameAr: schema_1.food.nameAr,
            foodNameFr: schema_1.food.nameFr,
            foodDescription: schema_1.food.description,
            foodDescriptionAr: schema_1.food.descriptionAr,
            foodImage: schema_1.food.image,
            foodPrice: schema_1.food.price,
            isOutOfStock: schema_1.food.isOutOfStock,
        })
            .from(schema_1.offerFoods)
            .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.offerFoods.foodId, schema_1.food.id))
            .where((0, drizzle_orm_1.eq)(schema_1.offerFoods.offerId, id));
        const uniqueFoodIds = [...new Set(offerFoodRows.map((f) => f.foodId))];
        const foodVariationsMap = await getFoodVariationsMap(uniqueFoodIds);
        const allAddonIds = [
            ...new Set(offerFoodRows.flatMap((r) => parseJsonArray(r.addonIds).map((id) => String(id)).filter(Boolean))),
        ];
        const addonsMap = await getAddonsMap(allAddonIds);
        const foods = offerFoodRows.map((f) => formatBundleFoodItem(f, foodVariationsMap, addonsMap));
        return (0, response_1.SuccessResponse)(res, {
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
    }
    catch (error) {
        console.error("Error fetching bundle by ID:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.getBundleById = getBundleById;
