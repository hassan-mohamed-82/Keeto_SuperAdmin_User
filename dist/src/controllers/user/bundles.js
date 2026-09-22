"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBundleById = exports.getAllBundles = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
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
            restaurantLogo: schema_1.restaurants.logo,
        })
            .from(schema_1.offers)
            .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.offers.restaurantId, schema_1.restaurants.id))
            .where(whereConditions);
        // For each offer, load its foods
        const offerIds = offersRows.map((o) => o.id);
        let offerFoodsMap = new Map();
        if (offerIds.length > 0) {
            const offerFoodRows = await connection_1.db
                .select({
                offerId: schema_1.offerFoods.offerId,
                foodId: schema_1.offerFoods.foodId,
                quantity: schema_1.offerFoods.quantity,
                variations: schema_1.offerFoods.variations,
                foodName: schema_1.food.name,
                foodNameAr: schema_1.food.nameAr,
                foodImage: schema_1.food.image,
                foodPrice: schema_1.food.price,
            })
                .from(schema_1.offerFoods)
                .innerJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.offerFoods.foodId, schema_1.food.id))
                .where((0, drizzle_orm_1.inArray)(schema_1.offerFoods.offerId, offerIds));
            for (const row of offerFoodRows) {
                if (!offerFoodsMap.has(row.offerId)) {
                    offerFoodsMap.set(row.offerId, []);
                }
                offerFoodsMap.get(row.offerId).push({
                    foodId: row.foodId,
                    quantity: row.quantity,
                    variations: row.variations ?? [],
                    name: row.foodName,
                    nameAr: row.foodNameAr,
                    image: row.foodImage,
                    price: Number(row.foodPrice),
                });
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
                    logo: o.restaurantLogo,
                }
                : null,
            foods: offerFoodsMap.get(o.id) ?? [],
        }));
        return res.status(200).json({
            success: true,
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
        return res.status(200).json({
            success: true,
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
                foods: offerFoodRows.map((f) => ({
                    foodId: f.foodId,
                    quantity: f.quantity,
                    variations: f.variations ?? [],
                    optionIds: f.optionIds ?? [],
                    name: f.foodName,
                    nameAr: f.foodNameAr,
                    nameFr: f.foodNameFr,
                    description: f.foodDescription,
                    descriptionAr: f.foodDescriptionAr,
                    image: f.foodImage,
                    originalPrice: Number(f.foodPrice),
                    isOutOfStock: f.isOutOfStock,
                })),
            },
        });
    }
    catch (error) {
        console.error("Error fetching bundle by ID:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.getBundleById = getBundleById;
