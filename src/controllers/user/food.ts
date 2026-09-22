import { Request, Response } from "express";
import { eq, and, or, isNull, lte, gte } from "drizzle-orm";
import { db } from "../../models/connection";
import {
    food,
    restaurants,
    categories,
    subcategories,
} from "../../models/schema";
import { activeFoodCondition } from "../../helpers/foodConditions";
import { formatFoodsList } from "../../services/foodFormat";
import { getUserFavoritesSets } from "../../services/userFavoritesFood";
import { resolveBranchIdFromAddress, type ServiceModule } from "../../helpers/pricing.helper";

// ==========================================
// User Food / Product Details Controller
// ==========================================

export const getProductById = async (req: Request, res: Response) => {
    try {
        const { id: foodId } = req.params;
        const now = new Date();
        const userId = (req as any).user?.id || (req as any).user?._id;
        const branchIdParam = req.query?.branchId as string | undefined;
        const addressIdParam = req.query?.addressId as string | undefined;
        const serviceModuleParam = req.query?.serviceModule as ServiceModule | undefined;

        // 1. Fetch raw food with category, subcategory, and restaurant
        const rawFoodRows = await db
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
                discountType: food.discount_type,
                discountValue: food.discount_value,
                isOutOfStock: food.isOutOfStock,
                image: food.image,
                points: food.points,
                addonsId: food.addonsId,
                restaurantId: food.restaurantid,

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

                restaurant: {
                    id: restaurants.id,
                    name: restaurants.name,
                    nameAr: restaurants.nameAr,
                    nameFr: restaurants.nameFr,
                    logo: restaurants.logo,
                    cover: restaurants.cover,
                    address: restaurants.address,
                    addressAr: restaurants.addressAr,
                    addressFr: restaurants.addressFr,
                    minDeliveryTime: restaurants.minDeliveryTime,
                    maxDeliveryTime: restaurants.maxDeliveryTime,
                    deliveryTimeUnit: restaurants.deliveryTimeUnit,
                    callcenterphone: restaurants.callcenterphone,
                    status: restaurants.status,
                },
            })
            .from(food)
            .innerJoin(restaurants, eq(food.restaurantid, restaurants.id))
            .leftJoin(categories, eq(food.categoryid, categories.id))
            .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
            .where(
                and(
                    eq(food.id, foodId),
                    eq(food.status, "active"),
                    activeFoodCondition,
                    eq(restaurants.status, "active"),
                    or(isNull(categories.id), eq(categories.status, "active")),
                    or(isNull(subcategories.id), eq(subcategories.status, "active"))
                )
            )
            .limit(1);

        if (!rawFoodRows || rawFoodRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Product not found or currently unavailable",
            });
        }

        const rawFood = rawFoodRows[0];
        const restaurantId = rawFood.restaurantId;

        // 2. Resolve target branch and service module
        let targetBranchId: string | null = branchIdParam || null;
        let serviceModule: ServiceModule | undefined = serviceModuleParam;

        if (branchIdParam) {
            if (!serviceModule) serviceModule = "takeaway";
        } else if (addressIdParam) {
            if (!serviceModule) serviceModule = "delivery";
            targetBranchId = await resolveBranchIdFromAddress(addressIdParam, restaurantId);
        }

        const { favoriteFoodIds, favoriteRestaurantIds } = await getUserFavoritesSets(userId);

        // 3. Format food using the shared direct-first discount resolver.
        const formattedFoods = await formatFoodsList(
            [rawFood],
            restaurantId,
            userId,
            favoriteFoodIds,
            targetBranchId,
            serviceModule
        );

        if (!formattedFoods || formattedFoods.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Product is not available for the selected branch",
            });
        }

        const formattedFood = formattedFoods[0];

        return res.status(200).json({
            success: true,
            message: "Product details retrieved successfully",
            data: formattedFood,
        });

    } catch (error) {
        console.error("Error fetching product details by ID:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getFoodById = getProductById;
