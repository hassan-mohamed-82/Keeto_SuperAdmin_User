import { Request, Response } from "express";
import { eq, and, or, isNull, lte, gte, inArray } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    discounts,
    discountFoods,
    discountRestaurants,
    food,
    restaurants,
    categories,
    subcategories,
} from "../../models/schema";
import { activeFoodCondition } from "../../helpers/foodConditions";
import { formatFoodsList } from "../../services/foodFormat";
import { getUserFavoritesSets } from "../../services/userFavoritesFood";
import { resolveBranchIdFromAddress, type ServiceModule } from "../../helpers/pricing.helper";

interface OfferDiscountMeta {
    discountId: string;
    discountName: string;
    discountNameAr: string | null;
    discountNameFr: string | null;
    discountType: string;
    discountValue: number | null;
    maxDiscount: number | null;
    minOrderAmount: number | null;
    startDate: Date | null;
    endDate: Date | null;
    isGlobal: boolean;
    discountLogo: string | null;
    restaurant?: any;
}

const attachDiscountDetails = (item: any, meta?: OfferDiscountMeta) => {
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
        } else if (["fixed_amount", "amount", "fixed"].includes(meta.discountType) && meta.discountValue) {
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

export const getRestaurantOffers = async (req: Request, res: Response) => {
    try {
        const { restaurantId } = req.params;
        const now = new Date();
        const userId = (req as any).user?.id || (req as any).user?._id;
        const branchIdParam = req.query?.branchId as string | undefined;
        const addressIdParam = req.query?.addressId as string | undefined;
        const serviceModuleParam = req.query?.serviceModule as ServiceModule | undefined;

        let targetBranchId: string | null = branchIdParam || null;
        let serviceModule: ServiceModule | undefined = serviceModuleParam;

        if (branchIdParam) {
            if (!serviceModule) serviceModule = "takeaway";
        } else if (addressIdParam) {
            if (!serviceModule) serviceModule = "delivery";
            targetBranchId = await resolveBranchIdFromAddress(addressIdParam, restaurantId);
        }

        const { favoriteFoodIds } = await getUserFavoritesSets(userId);

        const offersData = await db
            .select({
                foodId: food.id,
                foodName: food.name,
                foodNameAr: food.nameAr,
                foodNameFr: food.nameFr,
                description: food.description,
                descriptionAr: food.descriptionAr,
                descriptionFr: food.descriptionFr,
                price: food.price,
                foodDiscountType: food.discount_type,
                foodDiscountValue: food.discount_value,
                isOutOfStock: food.isOutOfStock,
                image: food.image,
                points: food.points,
                addonsId: food.addonsId,

                // تفاصيل الخصم
                discountId: discounts.id,
                discountName: discounts.name,
                discountNameAr: discounts.nameAr,
                discountNameFr: discounts.nameFr,
                discountType: discounts.discountType,
                discountValue: discounts.discountValue,
                maxDiscount: discounts.maxDiscount,
                minOrderAmount: discounts.minOrderAmount,
                startDate: discounts.startDate,
                endDate: discounts.endDate,
                isGlobal: discounts.isGlobal,
                logo: discounts.logo,

                categoryId: categories.id,
                categoryName: categories.name,
                categoryNameAr: categories.nameAr,
                categoryNameFr: categories.nameFr,

                subcategoryId: subcategories.id,
                subcategoryName: subcategories.name,
                subcategoryNameAr: subcategories.nameAr,
                subcategoryNameFr: subcategories.nameFr,
                subcategoryImage: subcategories.image,
                order_level: subcategories.order_Level,
            })
            .from(discountFoods)
            .innerJoin(discounts, eq(discountFoods.discountId, discounts.id))
            .innerJoin(food, eq(discountFoods.foodId, food.id))
            .leftJoin(categories, eq(food.categoryid, categories.id))
            .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
            .where(
                and(
                    eq(food.restaurantid, restaurantId),
                    eq(food.status, "active"),
                    activeFoodCondition,
                    or(isNull(categories.id), eq(categories.status, "active")),
                    or(isNull(subcategories.id), eq(subcategories.status, "active")),
                    eq(discounts.isActive, true),
                    or(isNull(discounts.startDate), lte(discounts.startDate, now)),
                    or(isNull(discounts.endDate), gte(discounts.endDate, now))
                )
            );

        if (offersData.length === 0) {
            return res.status(200).json({
                success: true,
                message: "Restaurant offers retrieved successfully",
                data: [],
            });
        }

        const offerMetadataMap = new Map<string, OfferDiscountMeta>();
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

        const formattedOffers = await formatFoodsList(
            offersData,
            restaurantId,
            userId,
            favoriteFoodIds,
            targetBranchId,
            serviceModule
        );

        const formattedResults = formattedOffers.map((item) => {
            const meta = offerMetadataMap.get(item.id);
            return attachDiscountDetails(item, meta);
        });

        return res.status(200).json({
            success: true,
            message: "Restaurant offers retrieved successfully",
            data: formattedResults,
        });

    } catch (error) {
        console.error("Error fetching restaurant offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getAllOffers = async (req: Request, res: Response) => {
    try {
        const now = new Date();
        const userId = (req as any).user?.id || (req as any).user?._id;
        const { favoriteFoodIds } = await getUserFavoritesSets(userId);

        const globalOffers = await db
            .select({
                foodId: food.id,
                foodName: food.name,
                foodNameAr: food.nameAr,
                foodNameFr: food.nameFr,
                description: food.description,
                descriptionAr: food.descriptionAr,
                descriptionFr: food.descriptionFr,
                price: food.price,
                foodDiscountType: food.discount_type,
                foodDiscountValue: food.discount_value,
                image: food.image,
                points: food.points,
                isOutOfStock: food.isOutOfStock,
                addonsId: food.addonsId,

                // تفاصيل الخصم
                discountId: discounts.id,
                discountName: discounts.name,
                discountNameAr: discounts.nameAr,
                discountNameFr: discounts.nameFr,
                discountType: discounts.discountType,
                discountValue: discounts.discountValue,
                maxDiscount: discounts.maxDiscount,
                minOrderAmount: discounts.minOrderAmount,
                startDate: discounts.startDate,
                endDate: discounts.endDate,
                isGlobal: discounts.isGlobal,
                logo: discounts.logo,

                categoryId: categories.id,
                categoryName: categories.name,
                categoryNameAr: categories.nameAr,
                categoryNameFr: categories.nameFr,

                subcategoryId: subcategories.id,
                subcategoryName: subcategories.name,
                subcategoryNameAr: subcategories.nameAr,
                subcategoryNameFr: subcategories.nameFr,
                subcategoryImage: subcategories.image,
                order_level: subcategories.order_Level,

                restaurantId: restaurants.id,
                // تفاصيل المطعم
                restaurant: {
                    id: restaurants.id,
                    name: restaurants.name,
                    nameAr: restaurants.nameAr,
                    nameFr: restaurants.nameFr,
                    logo: restaurants.logo,
                    cover: restaurants.cover,
                    address: restaurants.address,
                    minDeliveryTime: restaurants.minDeliveryTime,
                    maxDeliveryTime: restaurants.maxDeliveryTime,
                    deliveryTimeUnit: restaurants.deliveryTimeUnit,
                }
            })
            .from(discountFoods)
            .innerJoin(discounts, eq(discountFoods.discountId, discounts.id))
            .innerJoin(food, eq(discountFoods.foodId, food.id))
            .innerJoin(restaurants, eq(food.restaurantid, restaurants.id))
            .leftJoin(categories, eq(food.categoryid, categories.id))
            .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
            .where(
                and(
                    eq(discounts.isActive, true),
                    eq(restaurants.status, "active"),
                    eq(food.status, "active"),
                    activeFoodCondition,
                    or(isNull(categories.id), eq(categories.status, "active")),
                    or(isNull(subcategories.id), eq(subcategories.status, "active")),
                    or(isNull(discounts.startDate), lte(discounts.startDate, now)),
                    or(isNull(discounts.endDate), gte(discounts.endDate, now))
                )
            );

        if (globalOffers.length === 0) {
            return res.status(200).json({
                success: true,
                message: "All platform offers retrieved successfully",
                data: [],
            });
        }

        // Group foods by restaurant to run formatFoodsList per restaurant
        const offersByRestaurant = new Map<string, any[]>();
        const offerMetadataMap = new Map<string, OfferDiscountMeta>();

        for (const row of globalOffers) {
            if (!offersByRestaurant.has(row.restaurantId)) {
                offersByRestaurant.set(row.restaurantId, []);
            }
            offersByRestaurant.get(row.restaurantId)!.push(row);
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

        const formattedResults: any[] = [];
        for (const [rId, rFoods] of offersByRestaurant.entries()) {
            const formatted = await formatFoodsList(
                rFoods,
                rId,
                userId,
                favoriteFoodIds
            );
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

    } catch (error) {
        console.error("Error fetching all offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getAllDiscountsWithProducts = async (req: Request, res: Response) => {
    try {
        const now = new Date();
        const userId = (req as any).user?.id || (req as any).user?._id;
        const restaurantIdFilter = (req.params?.restaurantId || req.query?.restaurantId) as string | undefined;
        const branchIdParam = req.query?.branchId as string | undefined;
        const addressIdParam = req.query?.addressId as string | undefined;
        const serviceModuleParam = req.query?.serviceModule as ServiceModule | undefined;

        let targetBranchId: string | null = branchIdParam || null;
        let serviceModule: ServiceModule | undefined = serviceModuleParam;

        if (branchIdParam) {
            if (!serviceModule) serviceModule = "takeaway";
        } else if (addressIdParam && restaurantIdFilter) {
            if (!serviceModule) serviceModule = "delivery";
            targetBranchId = await resolveBranchIdFromAddress(addressIdParam, restaurantIdFilter);
        }

        const { favoriteFoodIds } = await getUserFavoritesSets(userId);

        const nowConditions = and(
            eq(discounts.isActive, true),
            or(isNull(discounts.startDate), lte(discounts.startDate, now)),
            or(isNull(discounts.endDate), gte(discounts.endDate, now))
        );

        let activeDiscountsRows: any[] = [];
        if (restaurantIdFilter) {
            const restDiscounts = await db
                .select({ discount: discounts })
                .from(discounts)
                .innerJoin(discountRestaurants, eq(discounts.id, discountRestaurants.discountId))
                .where(and(eq(discountRestaurants.restaurantId, restaurantIdFilter), nowConditions));

            const globalDiscounts = await db
                .select({ discount: discounts })
                .from(discounts)
                .where(and(eq(discounts.isGlobal, true), nowConditions));

            const foodLinkedDiscounts = await db
                .select({ discount: discounts })
                .from(discounts)
                .innerJoin(discountFoods, eq(discounts.id, discountFoods.discountId))
                .innerJoin(food, eq(discountFoods.foodId, food.id))
                .where(and(eq(food.restaurantid, restaurantIdFilter), nowConditions));

            const discountMap = new Map<string, any>();
            [...restDiscounts, ...globalDiscounts, ...foodLinkedDiscounts].forEach((d) => {
                if (!discountMap.has(d.discount.id)) {
                    discountMap.set(d.discount.id, d.discount);
                }
            });
            activeDiscountsRows = Array.from(discountMap.values());
        } else {
            activeDiscountsRows = await db
                .select()
                .from(discounts)
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
            inArray(discountFoods.discountId, discountIds),
            eq(food.status, "active"),
            eq(restaurants.status, "active"),
            activeFoodCondition,
            or(isNull(categories.id), eq(categories.status, "active")),
            or(isNull(subcategories.id), eq(subcategories.status, "active")),
        ];

        if (restaurantIdFilter) {
            foodWhereConditions.push(eq(food.restaurantid, restaurantIdFilter));
        }

        const productsRows = await db
            .select({
                discountId: discountFoods.discountId,
                foodId: food.id,
                foodName: food.name,
                foodNameAr: food.nameAr,
                foodNameFr: food.nameFr,
                description: food.description,
                descriptionAr: food.descriptionAr,
                descriptionFr: food.descriptionFr,
                price: food.price,
                foodDiscountType: food.discount_type,
                foodDiscountValue: food.discount_value,
                isOutOfStock: food.isOutOfStock,
                image: food.image,
                points: food.points,
                addonsId: food.addonsId,

                categoryId: categories.id,
                categoryName: categories.name,
                categoryNameAr: categories.nameAr,
                categoryNameFr: categories.nameFr,

                subcategoryId: subcategories.id,
                subcategoryName: subcategories.name,
                subcategoryNameAr: subcategories.nameAr,
                subcategoryNameFr: subcategories.nameFr,
                subcategoryImage: subcategories.image,
                order_level: subcategories.order_Level,

                restaurantId: restaurants.id,
                restaurant: {
                    id: restaurants.id,
                    name: restaurants.name,
                    nameAr: restaurants.nameAr,
                    nameFr: restaurants.nameFr,
                    logo: restaurants.logo,
                    cover: restaurants.cover,
                    address: restaurants.address,
                    minDeliveryTime: restaurants.minDeliveryTime,
                    maxDeliveryTime: restaurants.maxDeliveryTime,
                    deliveryTimeUnit: restaurants.deliveryTimeUnit,
                },
            })
            .from(discountFoods)
            .innerJoin(food, eq(discountFoods.foodId, food.id))
            .innerJoin(restaurants, eq(food.restaurantid, restaurants.id))
            .leftJoin(categories, eq(food.categoryid, categories.id))
            .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
            .where(and(...foodWhereConditions));

        const discountProductsMap = new Map<string, Map<string, { restaurant: any; rows: any[] }>>();
        for (const row of productsRows) {
            if (!discountProductsMap.has(row.discountId)) {
                discountProductsMap.set(row.discountId, new Map());
            }
            const restMap = discountProductsMap.get(row.discountId)!;
            if (!restMap.has(row.restaurantId)) {
                restMap.set(row.restaurantId, {
                    restaurant: row.restaurant,
                    rows: [],
                });
            }
            restMap.get(row.restaurantId)!.rows.push(row);
        }

        const result: any[] = [];

        for (const d of activeDiscountsRows) {
            const meta: OfferDiscountMeta = {
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
            const allProductsForDiscount: any[] = [];
            const uniqueRestaurants: any[] = [];

            if (restMap) {
                for (const [rId, { restaurant, rows }] of restMap.entries()) {
                    uniqueRestaurants.push(restaurant);
                    const formatted = await formatFoodsList(
                        rows,
                        rId,
                        userId,
                        favoriteFoodIds,
                        targetBranchId,
                        serviceModule
                    );

                    for (const item of formatted) {
                        const enrichedItem = attachDiscountDetails(item, meta);
                        allProductsForDiscount.push({
                            ...enrichedItem,
                            restaurant,
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

    } catch (error) {
        console.error("Error fetching discounts with products:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

