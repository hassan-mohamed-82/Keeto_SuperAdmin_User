import { Request, Response } from "express";
import { eq, and, or, isNull, isNotNull, lte, gte, inArray, sql } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    discounts,
    discountGroups,
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
import { formatProductsWithDiscounts } from "../../services/discount.service";

const attachDiscountDetails = (item: any) => {
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
                discountId: food.discountId, // groupId — crucial for discount.service
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
            })
            .from(food)
            .leftJoin(discountGroups, eq(food.discountId, discountGroups.id))
            .leftJoin(discounts, eq(discountGroups.discountId, discounts.id))
            .leftJoin(categories, eq(food.categoryid, categories.id))
            .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
            .where(
                and(
                    eq(food.restaurantid, restaurantId),
                    eq(food.status, "active"),
                    activeFoodCondition,
                    or(isNull(categories.id), eq(categories.status, "active")),
                    or(isNull(subcategories.id), eq(subcategories.status, "active")),
                    // Only restaurant/campaign discounts — no direct product discounts
                    and(
                        isNotNull(food.discountId),
                        eq(discounts.isActive, true),
                        or(isNull(discounts.startDate), lte(discounts.startDate, now)),
                        or(isNull(discounts.endDate), gte(discounts.endDate, now)),
                        or(isNull(discounts.usageLimit), sql`${discounts.usedCount} < ${discounts.usageLimit}`)
                    )
                )
            );

        if (offersData.length === 0) {
            return res.status(200).json({
                success: true,
                message: "Restaurant offers retrieved successfully",
                data: [],
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

        // Only restaurant/global campaign discounts — product-level are excluded by the SQL query
        const formattedResults = formattedOffers
            .filter((item) =>
                item.discountAmount > 0 &&
                (item.discountSource === "restaurant" || item.discountSource === "global")
            )
            .map(attachDiscountDetails);

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

// ==========================================
// 2. GET All Offers (Flat list across all active restaurants)
// ==========================================
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
                discountId: food.discountId,
                foodDiscountType: food.discount_type,
                foodDiscountValue: food.discount_value,
                image: food.image,
                points: food.points,
                isOutOfStock: food.isOutOfStock,
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
            .from(food)
            .innerJoin(restaurants, eq(food.restaurantid, restaurants.id))
            .leftJoin(discountGroups, eq(food.discountId, discountGroups.id))
            .leftJoin(discounts, eq(discountGroups.discountId, discounts.id))
            .leftJoin(categories, eq(food.categoryid, categories.id))
            .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
            .where(
                and(
                    eq(restaurants.status, "active"),
                    eq(food.status, "active"),
                    activeFoodCondition,
                    or(isNull(categories.id), eq(categories.status, "active")),
                    or(isNull(subcategories.id), eq(subcategories.status, "active")),
                    or(
                        // 1. Active campaign discount
                        and(
                            isNotNull(food.discountId),
                            eq(discounts.isActive, true),
                            or(isNull(discounts.startDate), lte(discounts.startDate, now)),
                            or(isNull(discounts.endDate), gte(discounts.endDate, now)),
                            or(isNull(discounts.usageLimit), sql`${discounts.usedCount} < ${discounts.usageLimit}`)
                        ),
                        // 2. Direct product discount
                        and(
                            isNotNull(food.discount_type),
                            isNotNull(food.discount_value),
                            sql`CAST(${food.discount_value} AS DECIMAL(10,2)) > 0`
                        )
                    )
                )
            );

        if (globalOffers.length === 0) {
            return res.status(200).json({
                success: true,
                message: "All platform offers retrieved successfully",
                data: [],
            });
        }

        const offersByRestaurant = new Map<string, any[]>();
        const restaurantMap = new Map<string, any>();

        for (const row of globalOffers) {
            if (!offersByRestaurant.has(row.restaurantId)) {
                offersByRestaurant.set(row.restaurantId, []);
                restaurantMap.set(row.restaurantId, row.restaurant);
            }
            offersByRestaurant.get(row.restaurantId)!.push(row);
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
                if (
                    item.discountAmount > 0 &&
                    (item.discountSource === "restaurant" || item.discountSource === "global")
                ) {
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
    } catch (error) {
        console.error("Error fetching all offers:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

// ==========================================
// 3. GET Discounts with Products (Campaigns grouping foods)
// ==========================================
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
            or(isNull(discounts.endDate), gte(discounts.endDate, now)),
            or(isNull(discounts.usageLimit), sql`${discounts.usedCount} < ${discounts.usageLimit}`)
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

            const discountMap = new Map<string, any>();
            [...restDiscounts, ...globalDiscounts].forEach((d) => {
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

        const activeDiscountIds = activeDiscountsRows.map((d) => d.id);
        const groups = await db
            .select()
            .from(discountGroups)
            .where(inArray(discountGroups.discountId, activeDiscountIds));

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

        const groupToDiscountIdMap = new Map<string, string>();
        const groupsByDiscountIdMap = new Map<string, any[]>();
        const groupIds: string[] = [];

        for (const g of groups) {
            groupIds.push(g.id);
            groupToDiscountIdMap.set(g.id, g.discountId);
            if (!groupsByDiscountIdMap.has(g.discountId)) {
                groupsByDiscountIdMap.set(g.discountId, []);
            }
            groupsByDiscountIdMap.get(g.discountId)!.push(g);
        }

        const foodWhereConditions = [
            inArray(food.discountId, groupIds),
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
                foodId: food.id,
                foodName: food.name,
                foodNameAr: food.nameAr,
                foodNameFr: food.nameFr,
                description: food.description,
                descriptionAr: food.descriptionAr,
                descriptionFr: food.descriptionFr,
                price: food.price,
                discountId: food.discountId, // groupId
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
            })
            .from(food)
            .innerJoin(restaurants, eq(food.restaurantid, restaurants.id))
            .leftJoin(categories, eq(food.categoryid, categories.id))
            .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
            .where(and(...foodWhereConditions));

        const discountProductsMap = new Map<string, Map<string, any[]>>();
        for (const row of productsRows) {
            const campaignId = row.discountId ? groupToDiscountIdMap.get(row.discountId) : null;
            if (!campaignId) continue;
            if (!discountProductsMap.has(campaignId)) {
                discountProductsMap.set(campaignId, new Map());
            }
            const restMap = discountProductsMap.get(campaignId)!;
            if (!restMap.has(row.restaurantId)) {
                restMap.set(row.restaurantId, []);
            }
            restMap.get(row.restaurantId)!.push(row);
        }

        const result: any[] = [];

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
            const allProductsForDiscount: any[] = [];

            if (restMap) {
                for (const [rId, rows] of restMap.entries()) {
                    const formatted = await formatFoodsList(
                        rows,
                        rId,
                        userId,
                        favoriteFoodIds,
                        targetBranchId,
                        serviceModule
                    );

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
    } catch (error) {
        console.error("Error fetching discounts with products:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
