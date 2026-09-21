import { Request, Response } from "express";
import { eq, and, lte, gte, inArray } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    restaurants,
    offers,
    offerFoods,
    food,
} from "../../models/schema";

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
                restaurantLogo: restaurants.logo,
            })
            .from(offers)
            .leftJoin(restaurants, eq(offers.restaurantId, restaurants.id))
            .where(whereConditions);

        // For each offer, load its foods
        const offerIds = offersRows.map((o) => o.id);
        let offerFoodsMap = new Map<string, any[]>();

        if (offerIds.length > 0) {
            const offerFoodRows = await db
                .select({
                    offerId: offerFoods.offerId,
                    foodId: offerFoods.foodId,
                    quantity: offerFoods.quantity,
                    variations: offerFoods.variations,
                    foodName: food.name,
                    foodNameAr: food.nameAr,
                    foodImage: food.image,
                    foodPrice: food.price,
                })
                .from(offerFoods)
                .innerJoin(food, eq(offerFoods.foodId, food.id))
                .where(inArray(offerFoods.offerId, offerIds));

            for (const row of offerFoodRows) {
                if (!offerFoodsMap.has(row.offerId)) {
                    offerFoodsMap.set(row.offerId, []);
                }
                offerFoodsMap.get(row.offerId)!.push({
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
    } catch (error) {
        console.error("Error fetching bundle by ID:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};