import { Request, Response } from "express";
import { eq, and, or, isNull, lte, gte } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    discounts,
    discountFoods,
    food,
    restaurants,
    categories,
    subcategories,
} from "../../models/schema";
import { activeFoodCondition } from "../../helpers/foodConditions";
import { formatFoodsList } from "../../services/foodFormat";
import { getUserFavoritesSets } from "../../services/userFavoritesFood";
import { resolveBranchIdFromAddress, type ServiceModule } from "../../helpers/pricing.helper";

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

        const formattedOffers = await formatFoodsList(
            offersData,
            restaurantId,
            userId,
            favoriteFoodIds,
            targetBranchId,
            serviceModule
        );

        return res.status(200).json({
            success: true,
            message: "Restaurant offers retrieved successfully",
            data: formattedOffers,
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
                discountType: discounts.discountType,
                discountValue: discounts.discountValue,
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
        const offerMetadataMap = new Map<string, { discountId: string; discountName: string; isGlobal: boolean; discountLogo: string | null; restaurant: any }>();

        for (const row of globalOffers) {
            if (!offersByRestaurant.has(row.restaurantId)) {
                offersByRestaurant.set(row.restaurantId, []);
            }
            offersByRestaurant.get(row.restaurantId)!.push(row);
            offerMetadataMap.set(row.foodId, {
                discountId: row.discountId,
                discountName: row.discountName,
                isGlobal: Boolean(row.isGlobal),
                discountLogo: row.logo,
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
                formattedResults.push({
                    ...item,
                    discountId: meta?.discountId ?? null,
                    discountName: meta?.discountName ?? null,
                    isGlobal: meta?.isGlobal ?? false,
                    discountLogo: meta?.discountLogo ?? null,
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



// import { Request, Response } from "express";
// import { eq, and, or, isNull, lte, gte } from "drizzle-orm";
// import { db } from "../../models/connection"; // مسار الاتصال بقاعدة البيانات
// import { discounts, discountFoods, food, restaurants, categories, subcategories, favorites } from "../../models/schema";
// import { activeFoodCondition } from "../../helpers/foodConditions";

// export const getRestaurantOffers = async (req: Request, res: Response) => {
//     try {
//         const { restaurantId } = req.params;
//         const now = new Date();
//         const userId = (req as any).user?.id || (req as any).user?._id;

//         const favoriteFoodIds = new Set();
//         if (userId) {
//             const userFavorites = await db
//                 .select({ foodId: favorites.foodId })
//                 .from(favorites)
//                 .where(eq(favorites.userId, userId));
//             userFavorites.forEach(f => {
//                 if (f.foodId) favoriteFoodIds.add(f.foodId);
//             });
//         }

//         const offersData = await db
//             .select({
//                 foodId: food.id,
//                 foodName: food.name,
//                 foodNameAr: food.nameAr,
//                 foodNameFr: food.nameFr,
//                 description: food.description,
//                 descriptionAr: food.descriptionAr,
//                 descriptionFr: food.descriptionFr,
//                 price: food.price,
//                 foodDiscountType: food.discount_type,
//                 foodDiscountValue: food.discount_value,
//                 image: food.image,
//                 points: food.points,

//                 categoryId: categories.id,
//                 categoryName: categories.name,
//                 categoryNameAr: categories.nameAr,
//                 categoryNameFr: categories.nameFr,

//                 subcategoryId: subcategories.id,
//                 subcategoryName: subcategories.name,
//                 subcategoryNameAr: subcategories.nameAr,
//                 subcategoryNameFr: subcategories.nameFr,
//                 subcategoryImage: subcategories.image,
//                 order_level: subcategories.order_Level,
//             })
//             .from(discountFoods)
//             .innerJoin(discounts, eq(discountFoods.discountId, discounts.id))
//             .innerJoin(food, eq(discountFoods.foodId, food.id))
//             .leftJoin(categories, eq(food.categoryid, categories.id))
//             .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
//             .where(
//                 and(
//                     eq(food.restaurantid, restaurantId), // فلترة بالمطعم
//                     activeFoodCondition,
//                     eq(discounts.isActive, true), // الخصم مفعل

//                     // التأكد إن تاريخ الخصم ساري (لو التواريخ موجودة)
//                     or(isNull(discounts.startDate), lte(discounts.startDate, now)),
//                     or(isNull(discounts.endDate), gte(discounts.endDate, now))
//                 )
//             );

//         const formattedOffers = offersData.map(row => {
//             let calculatedDiscountPrice = Number(row.price);
//             let discountNote = "";

//             if (row.foodDiscountType === "percentage" && row.foodDiscountValue) {
//                 calculatedDiscountPrice = Number(row.price) - (Number(row.price) * Number(row.foodDiscountValue) / 100);
//             } else if (row.foodDiscountType === "amount" && row.foodDiscountValue) {
//                 calculatedDiscountPrice = Math.max(0, Number(row.price) - Number(row.foodDiscountValue));
//             }

//             return {
//                 id: row.foodId,
//                 name: row.foodName,
//                 nameAr: row.foodNameAr,
//                 nameFr: row.foodNameFr,
//                 description: row.description,
//                 descriptionAr: row.descriptionAr,
//                 descriptionFr: row.descriptionFr,
//                 price: Number(row.price),
//                 discountType: row.foodDiscountType ?? null,
//                 discountValue: row.foodDiscountValue !== null ? Number(row.foodDiscountValue) : null,
//                 discountPrice: calculatedDiscountPrice,
//                 discountNote,
//                 image: row.image,
//                 points: userId ? row.points : null,
//                 isFavorite: userId ? favoriteFoodIds.has(row.foodId) : false,
                
//                 variations: {}, 
//                 addons: {}, 
                
//                 category: row.categoryId ? {
//                     id: row.categoryId,
//                     name: row.categoryName,
//                     nameAr: row.categoryNameAr,
//                     nameFr: row.categoryNameFr,
//                 } : null,
//                 subcategory: row.subcategoryId ? {
//                     id: row.subcategoryId,
//                     name: row.subcategoryName,
//                     nameAr: row.subcategoryNameAr,
//                     nameFr: row.subcategoryNameFr,
//                     image: row.subcategoryImage,
//                     order_level: row.order_level,
//                 } : null,
//             };
//         });

//         return res.status(200).json({
//             success: true,
//             message: "Restaurant offers retrieved successfully",
//             data: formattedOffers,
//         });

//     } catch (error) {
//         console.error("Error fetching restaurant offers:", error);
//         return res.status(500).json({ success: false, message: "Internal server error" });
//     }
// };




// export const getAllOffers = async (req: Request, res: Response) => {
//     try {
//         const now = new Date();
//         const userId = (req as any).user?.id || (req as any).user?._id;

//         const favoriteFoodIds = new Set();
//         if (userId) {
//             const userFavorites = await db
//                 .select({ foodId: favorites.foodId })
//                 .from(favorites)
//                 .where(eq(favorites.userId, userId));
//             userFavorites.forEach(f => {
//                 if (f.foodId) favoriteFoodIds.add(f.foodId);
//             });
//         }

//         const globalOffers = await db
//             .select({
//                 foodId: food.id,
//                 foodName: food.name,
//                 foodNameAr: food.nameAr,
//                 foodNameFr: food.nameFr,
//                 description: food.description,
//                 descriptionAr: food.descriptionAr,
//                 descriptionFr: food.descriptionFr,
//                 price: food.price,
//                 foodDiscountType: food.discount_type,
//                 foodDiscountValue: food.discount_value,
//                 image: food.image,
//                 points: food.points,

//                 // تفاصيل الخصم
//                 discountId: discounts.id,
//                 discountName: discounts.name,
//                 discountType: discounts.discountType,
//                 discountValue: discounts.discountValue,
//                 isGlobal: discounts.isGlobal,
//                 logo: discounts.logo,

//                 categoryId: categories.id,
//                 categoryName: categories.name,
//                 categoryNameAr: categories.nameAr,
//                 categoryNameFr: categories.nameFr,

//                 subcategoryId: subcategories.id,
//                 subcategoryName: subcategories.name,
//                 subcategoryNameAr: subcategories.nameAr,
//                 subcategoryNameFr: subcategories.nameFr,
//                 subcategoryImage: subcategories.image,
//                 order_level: subcategories.order_Level,

//                 // تفاصيل المطعم
//                 restaurant: {
//                     id: restaurants.id,
//                     name: restaurants.name,
//                     nameAr: restaurants.nameAr,
//                     nameFr: restaurants.nameFr,
//                     logo: restaurants.logo,
//                     cover: restaurants.cover,
//                     address: restaurants.address,
//                     minDeliveryTime: restaurants.minDeliveryTime,
//                     maxDeliveryTime: restaurants.maxDeliveryTime,
//                     deliveryTimeUnit: restaurants.deliveryTimeUnit,
//                 }
//             })
//             .from(discountFoods)
//             .innerJoin(discounts, eq(discountFoods.discountId, discounts.id))
//             .innerJoin(food, eq(discountFoods.foodId, food.id))
//             .innerJoin(restaurants, eq(food.restaurantid, restaurants.id))
//             .leftJoin(categories, eq(food.categoryid, categories.id))
//             .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
//             .where(
//                 and(
//                     eq(discounts.isActive, true),
//                     eq(restaurants.status, "active"),
//                     activeFoodCondition,
//                     or(isNull(discounts.startDate), lte(discounts.startDate, now)),
//                     or(isNull(discounts.endDate), gte(discounts.endDate, now))
//                 )
//             );

//         const formattedOffers = globalOffers.map(row => {
//             let calculatedDiscountPrice = Number(row.price);
//             let discountNote = "";

//             if (row.foodDiscountType === "percentage" && row.foodDiscountValue) {
//                 calculatedDiscountPrice = Number(row.price) - (Number(row.price) * Number(row.foodDiscountValue) / 100);
//             } else if (row.foodDiscountType === "amount" && row.foodDiscountValue) {
//                 calculatedDiscountPrice = Math.max(0, Number(row.price) - Number(row.foodDiscountValue));
//             }

//             return {
//                 id: row.foodId,
//                 name: row.foodName,
//                 nameAr: row.foodNameAr,
//                 nameFr: row.foodNameFr,
//                 description: row.description,
//                 descriptionAr: row.descriptionAr,
//                 descriptionFr: row.descriptionFr,
//                 price: Number(row.price),
//                 discountType: row.foodDiscountType ?? null,
//                 discountValue: row.foodDiscountValue !== null ? Number(row.foodDiscountValue) : null,
//                 discountPrice: calculatedDiscountPrice,
//                 discountNote,
//                 image: row.image,
//                 points: userId ? row.points : null,
//                 isFavorite: userId ? favoriteFoodIds.has(row.foodId) : false,

//                 variations: {},
//                 addons: {},

//                 category: row.categoryId ? {
//                     id: row.categoryId,
//                     name: row.categoryName,
//                     nameAr: row.categoryNameAr,
//                     nameFr: row.categoryNameFr,
//                 } : null,
//                 subcategory: row.subcategoryId ? {
//                     id: row.subcategoryId,
//                     name: row.subcategoryName,
//                     nameAr: row.subcategoryNameAr,
//                     nameFr: row.subcategoryNameFr,
//                     image: row.subcategoryImage,
//                     order_level: row.order_level,
//                 } : null,

//                 discountId: row.discountId,
//                 discountName: row.discountName,
//                 isGlobal: row.isGlobal,
//                 discountLogo: row.logo,

//                 restaurant: row.restaurant,
//             };
//         });

//         return res.status(200).json({
//             success: true,
//             message: "All platform offers retrieved successfully",
//             data: formattedOffers,
//         });

//     } catch (error) {
//         console.error("Error fetching all offers:", error);
//         return res.status(500).json({ success: false, message: "Internal server error" });
//     }
// };