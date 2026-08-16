import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cuisines, categories, restaurants, food, favorites, foodVariations, variationOptions, addons, adonescategory, subcategories } from "../../models/schema";
import { eq, and, like, or, sql } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, UnauthorizedError } from "../../Errors";
import { getAvailableDiscounts, applyPriorityDiscount } from "../../utils/discount";
import { getUnavailableBranchesForFoods } from "../../helpers/food.helper";

// ==========================================
// 🔥 Helper: تجهيز favorites لو اليوزر عامل login
// ==========================================
const getUserFavoritesSets = async (userId?: string) => {
    const favoriteRestaurantIds = new Set<string>();
    const favoriteFoodIds = new Set<string>();

    if (!userId) return { favoriteRestaurantIds, favoriteFoodIds };

    const userFavorites = await db
        .select()
        .from(favorites)
        .where(eq(favorites.userId, userId));

    userFavorites.forEach(f => {
        if (f.restaurantId) favoriteRestaurantIds.add(f.restaurantId);
        if (f.foodId) favoriteFoodIds.add(f.foodId);
    });

    return { favoriteRestaurantIds, favoriteFoodIds };
};

// ==========================================
// 1. Home Screen
// ==========================================
export const getHomeScreen = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { favoriteRestaurantIds } = await getUserFavoritesSets(userId);

    const activeCuisines = await db.select({
        id: cuisines.id,
        name: cuisines.name,
        nameAr: cuisines.nameAr,
        nameFr: cuisines.nameFr,
        image: cuisines.Image
    }).from(cuisines).where(eq(cuisines.status, "active"));

    const activeCategories = await db.select({
        id: categories.id,
        name: categories.name,
        nameAr: categories.nameAr,
        nameFr: categories.nameFr,
        image: categories.Image
    }).from(categories).where(eq(categories.status, "active"));

    const restaurantsData = await db.select({
        id: restaurants.id,
        name: restaurants.name,
        nameAr: restaurants.nameAr,
        nameFr: restaurants.nameFr,
        cover: restaurants.cover,
        logo: restaurants.logo,
        address: restaurants.address,
        addressAr: restaurants.addressAr,
        addressFr: restaurants.addressFr,
        minDeliveryTime: restaurants.minDeliveryTime,
    }).from(restaurants).where(eq(restaurants.status, "active"));

    const popularRestaurants = restaurantsData.map(r => ({
        ...r,
        isFavorite: userId ? favoriteRestaurantIds.has(r.id) : false
    }));

    return SuccessResponse(res, {
        data: {
            cuisines: activeCuisines,
            categories: activeCategories,
            restaurants: popularRestaurants
        }
    });
};

// ==========================================
// 2. Restaurants by Cuisine
// ==========================================
export const getRestaurantsByCuisine = async (req: Request, res: Response) => {
    const { cuisineId } = req.params;
    const userId = req.user?.id;

    const { favoriteRestaurantIds } = await getUserFavoritesSets(userId);

    const data = await db.select({
        id: restaurants.id,
        name: restaurants.name,
        nameAr: restaurants.nameAr,
        nameFr: restaurants.nameFr,
        cover: restaurants.cover,
        logo: restaurants.logo,
        address: restaurants.address,
        addressAr: restaurants.addressAr,
        addressFr: restaurants.addressFr,
        minDeliveryTime: restaurants.minDeliveryTime,
    }).from(restaurants)
    .where(and(
        sql`JSON_CONTAINS(${restaurants.cuisineId}, ${JSON.stringify(cuisineId)})`
    ));

    const result = data.map(r => ({
        ...r,
        isFavorite: userId ? favoriteRestaurantIds.has(r.id) : false
    }));

    return SuccessResponse(res, { data: result });
};

// ==========================================
// 3. Foods by Category
// ==========================================
export const getFoodsByCategory = async (req: Request, res: Response) => {
    const { categoryId } = req.params;
    const userId = req.user?.id;

    const { favoriteFoodIds } = await getUserFavoritesSets(userId);

    const data = await db.select({
        foodId: food.id,
        foodName: food.name,
        foodNameAr: food.nameAr,
        foodNameFr: food.nameFr,
        foodImage: food.image,
        price: food.price,
        foodDiscountType: food.discount_type,   
        foodDiscountValue: food.discount_value, 
        isOutOfStock: food.isOutOfStock,
        restaurantId: restaurants.id,
        restaurantName: restaurants.name,
        restaurantNameAr: restaurants.nameAr,
        restaurantNameFr: restaurants.nameFr,
        restaurantLogo: restaurants.logo
    })
    .from(food)
    .leftJoin(restaurants, eq(food.restaurantid, restaurants.id))
    .where(and(
        eq(food.categoryid, categoryId),
        eq(food.status, "active")
    ));

    const uniqueRestaurants = [...new Set(data.map(f => f.restaurantId))];
    const discountsByRestaurant = new Map();
    for (const rId of uniqueRestaurants) {
        if (rId) discountsByRestaurant.set(rId, await getAvailableDiscounts(rId));
    }

    // ==========================================
    // حساب الفروع غير المتاحة لكل وجبة
    // ==========================================
    // الوجبات النشطة فقط (status == active) هي التي وصلت هنا،
    // لكن isOutOfStock ممكن تكون true → غير متاحة في كل الفروع
    const activeFoodIds = data
        .filter(f => !f.isOutOfStock)
        .map(f => f.foodId)
        .filter(Boolean) as string[];

    const unavailableBranchesMap = activeFoodIds.length > 0
        ? await getUnavailableBranchesForFoods(activeFoodIds)
        : new Map<string, string[]>();

    const result = data.map(f => {
        const availableDiscounts = discountsByRestaurant.get(f.restaurantId) || [];
        const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };

        const { price: finalDiscountPrice, discountNote } = applyPriorityDiscount(
            { id: f.foodId, discountType: f.foodDiscountType, discountValue: f.foodDiscountValue },
            Number(f.price),
            0,
            availableDiscounts,
            discountState,
            false
        );

        // إذا كانت الوجبة isOutOfStock → غير متاحة في جميع الفروع (null)
        // وإلا → قائمة الفروع غير المتاحة بالتحديد
        const unavailableBranches: string[] | null = f.isOutOfStock
            ? null
            : (unavailableBranchesMap.get(f.foodId!) ?? []);

        return {
            foodId: f.foodId,
            foodName: f.foodName,
            foodNameAr: f.foodNameAr,
            foodNameFr: f.foodNameFr,
            foodImage: f.foodImage,
            price: Number(f.price),
            discountPrice: finalDiscountPrice,
            discountNote,
            restaurantId: f.restaurantId,
            restaurantName: f.restaurantName,
            restaurantNameAr: f.restaurantNameAr,
            restaurantNameFr: f.restaurantNameFr,
            restaurantLogo: f.restaurantLogo,
            isOutOfStock: f.isOutOfStock,
            isFavorite: userId ? favoriteFoodIds.has(f.foodId) : false,
            unavailableBranches
        };
    });

    return SuccessResponse(res, { data: result });
};

// ==========================================
// 4. Restaurant Details + Menu
// ==========================================
export const getRestaurantDetails = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;
    const userId = req.user?.id;

    const { favoriteFoodIds, favoriteRestaurantIds } = await getUserFavoritesSets(userId);

    const [restaurantInfo] = await db.select().from(restaurants)
        .where(eq(restaurants.id, restaurantId));

    if (!restaurantInfo) throw new Error("Restaurant not found");

    const { ...safeRestaurantInfo } = restaurantInfo;

    const restaurantWithFav = {
        ...safeRestaurantInfo,
        isFavorite: userId ? favoriteRestaurantIds.has(restaurantId) : false
    };

    const rawMenu = await db.select({
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
        
        categoryId: categories.id,
        categoryName: categories.name,
        categoryNameAr: categories.nameAr,
        categoryNameFr: categories.nameFr,

        subcategoryId: subcategories.id,
        subcategoryName: subcategories.name,
        subcategoryNameAr: subcategories.nameAr,
        subcategoryNameFr: subcategories.nameFr,
        order_level: subcategories.order_Level,
        
        variationId: foodVariations.id,
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

        addonId: addons.id,
        addonName: addons.name,
        addonNameAr: addons.nameAr,
        addonNameFr: addons.nameFr,
        addonPrice: addons.price,
        addonStatus: addons.status,
        addonStockType: addons.stock_type,
        addonRestaurantId: addons.restaurantid,
        addonCreatedAt: addons.createdAt,
        addonUpdatedAt: addons.updatedAt,
        
        addonCategoryId: adonescategory.id,
        addonCategoryName: adonescategory.name,
        addonCategoryNameAr: adonescategory.nameAr,
        addonCategoryNameFr: adonescategory.nameFr,
    })
    .from(food)
    .leftJoin(categories, eq(food.categoryid, categories.id))
    .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
    .leftJoin(foodVariations, eq(food.id, foodVariations.foodId))
    .leftJoin(variationOptions, eq(foodVariations.id, variationOptions.variationId))
    .leftJoin(addons, sql`JSON_CONTAINS(${food.addonsId}, JSON_QUOTE(${addons.id}))`)
    .leftJoin(adonescategory, eq(addons.adonescategoryid, adonescategory.id))
    .where(and(
        eq(food.restaurantid, restaurantId),
        eq(food.status, "active")
    ));

    const availableDiscounts = await getAvailableDiscounts(restaurantId);

    const groupedMenuObj = rawMenu.reduce((acc: any, row) => {
        const catId = row.categoryId || "uncategorized";

        // 1. تجميع الكاتيجوري
        if (!acc[catId]) {
            acc[catId] = {
                id: catId === "uncategorized" ? null : catId,
                name: row.categoryName || "Other",
                nameAr: row.categoryNameAr || "أخرى",
                nameFr: row.categoryNameFr || "Autre",
                foods: {} 
            };
        }

        // 2. تجميع الأكل داخل الكاتيجوري مع حساب الخصم المباشر
        if (row.foodId) {
            if (!acc[catId].foods[row.foodId]) {
                const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };
                
                const { price: calculatedDiscountPrice, discountNote } = applyPriorityDiscount(
                    { id: row.foodId, discountType: row.foodDiscountType, discountValue: row.foodDiscountValue },
                    Number(row.price),
                    0,
                    availableDiscounts,
                    discountState,
                    false
                );

                acc[catId].foods[row.foodId] = {
                    id: row.foodId,
                    name: row.foodName,
                    nameAr: row.foodNameAr,
                    nameFr: row.foodNameFr,
                    description: row.description,
                    descriptionAr: row.descriptionAr,
                    descriptionFr: row.descriptionFr,
                    price: Number(row.price),
                    discountType: row.foodDiscountType ?? null,
                    discountValue: row.foodDiscountValue !== null ? Number(row.foodDiscountValue) : null,
                    discountPrice: calculatedDiscountPrice,
                    discountNote,
                    image: row.image,
                    isOutOfStock: row.isOutOfStock,
                    points: userId? row.points:null,
                    isFavorite: userId ? favoriteFoodIds.has(row.foodId) : false,
                    
                    variations: {}, 
                    addons: {}, 
                    
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
            }

            // 3. تجميع الـ Variations داخل الأكل
            if (row.variationId) {
                if (!acc[catId].foods[row.foodId].variations[row.variationId]) {
                    acc[catId].foods[row.foodId].variations[row.variationId] = {
                        id: row.variationId,
                        name: row.variationName,
                        nameAr: row.variationNameAr,
                        nameFr: row.variationNameFr,
                        isRequired: row.isRequired,
                        selectionType: row.selectionType,
                        min: row.min,
                        max: row.max,
                        options: {} 
                    };
                }

                // 4. تجميع الـ Options داخل الـ Variations
                if (row.optionId) {
                    if (!acc[catId].foods[row.foodId].variations[row.variationId].options[row.optionId]) {
                        acc[catId].foods[row.foodId].variations[row.variationId].options[row.optionId] = {
                            id: row.optionId,
                            name: row.optionName,
                            nameAr: row.optionNameAr,
                            nameFr: row.optionNameFr,
                            additionalPrice: row.additionalPrice
                        };
                    }
                }
            }

            // 5. تجميع الـ Addons داخل الأكل
            if (row.addonId) {
                if (!acc[catId].foods[row.foodId].addons[row.addonId]) {
                    acc[catId].foods[row.foodId].addons[row.addonId] = {
                        id: row.addonId,
                        name: row.addonName,
                        nameAr: row.addonNameAr,
                        nameFr: row.addonNameFr,
                        price: row.addonPrice,
                        status: row.addonStatus,
                        stockType: row.addonStockType,
                        restaurantId: row.addonRestaurantId,
                        createdAt: row.addonCreatedAt,
                        updatedAt: row.addonUpdatedAt,
                        category: row.addonCategoryId ? {
                            id: row.addonCategoryId,
                            name: row.addonCategoryName,
                            nameAr: row.addonCategoryNameAr,
                            nameFr: row.addonCategoryNameFr,
                        } : null
                    };
                }
            }
        }

        return acc;
    }, {});

    // 👇 تحويل الكاتيجوريز، الأكلات، الـ Variations، الـ Options، والـ Addons من Objects إلى Arrays
    // ثم حساب الفروع غير المتاحة لكل وجبة
    const allMenuFoods = Object.values(groupedMenuObj).flatMap((cat: any) => Object.values(cat.foods)) as any[];

    // الوجبات التي status == active لكن isOutOfStock == false هي المرشحة للفحص
    const menuActiveFoodIds = allMenuFoods
        .filter((f: any) => !f.isOutOfStock)
        .map((f: any) => f.id)
        .filter(Boolean) as string[];

    const menuUnavailableBranchesMap = menuActiveFoodIds.length > 0
        ? await getUnavailableBranchesForFoods(menuActiveFoodIds)
        : new Map<string, string[]>();

    const finalMenu = Object.values(groupedMenuObj).map((category: any) => {
        return {
            id: category.id,
            name: category.name,
            nameAr: category.nameAr,
            nameFr: category.nameFr,
            foods: Object.values(category.foods).map((f: any) => {
                // تحويل الـ variations والـ options
                f.variations = Object.values(f.variations).map((v: any) => {
                    v.options = Object.values(v.options); 
                    return v;
                });
                // تحويل الـ Addons
                f.addons = Object.values(f.addons);

                // إرفاق الفروع غير المتاحة
                // null → الوجبة غير متاحة في جميع الفروع (isOutOfStock)
                // [] أو [...] → قائمة الفروع غير المتاحة بالتحديد
                f.unavailableBranches = f.isOutOfStock
                    ? null
                    : (menuUnavailableBranchesMap.get(f.id) ?? []);

                return f;
            })
        };
    });

    // ==========================================
    // جلب الـ Addons مع الـ Categories (للقائمة العامة)
    // ==========================================
    const rawAddons = await db.select({
        addonId: addons.id,
        addonName: addons.name,
        addonNameAr: addons.nameAr,
        addonNameFr: addons.nameFr,
        addonPrice: addons.price,
        addonStockType: addons.stock_type,
        categoryId: adonescategory.id,
        categoryName: adonescategory.name,
        categoryNameAr: adonescategory.nameAr,
        categoryNameFr: adonescategory.nameFr,
    })
    .from(addons)
    .leftJoin(adonescategory, eq(addons.adonescategoryid, adonescategory.id))
    .where(and(
        eq(addons.restaurantid, restaurantId),
        eq(addons.status, "active")
    ));

    const groupedAddonsObj = rawAddons.reduce((acc: any, row) => {
        const catId = row.categoryId || "uncategorized";
        
        if (!acc[catId]) {
            acc[catId] = {
                id: catId === "uncategorized" ? null : catId,
                name: row.categoryName || "Other",
                nameAr: row.categoryNameAr || "أخرى",
                nameFr: row.categoryNameFr || "Autre",
                addons: []
            };
        }

        if (row.addonId) {
            acc[catId].addons.push({
                id: row.addonId,
                name: row.addonName,
                nameAr: row.addonNameAr,
                nameFr: row.addonNameFr,
                price: row.addonPrice,
                stockType: row.addonStockType
            });
        }

        return acc;
    }, {});

    const finalAddons = Object.values(groupedAddonsObj).map((category: any) => {
        return {
            id: category.id,
            name: category.name,
            nameAr: category.nameAr,
            nameFr: category.nameFr,
            addons: category.addons
        };
    });

    return SuccessResponse(res, {
        data: {
            restaurant: restaurantWithFav,
            menu: finalMenu,
            addons: finalAddons
        }
    });
};

// ==========================================
// 5. Toggle Favorite
// ==========================================
export const toggleFavorite = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    const userId = req.user.id;
    const { restaurantId, foodId } = req.body;

    if (!restaurantId && !foodId)
        throw new BadRequest("Restaurant ID or Food ID is required");

    if (restaurantId && foodId)
        throw new BadRequest("Send only one");

    const condition = restaurantId
        ? and(eq(favorites.userId, userId), eq(favorites.restaurantId, restaurantId))
        : and(eq(favorites.userId, userId), eq(favorites.foodId, foodId));

    const [existingFav] = await db.select().from(favorites).where(condition);

    if (existingFav) {
        await db.delete(favorites).where(eq(favorites.id, existingFav.id));
        return SuccessResponse(res, { isFavorite: false });
    }

    await db.insert(favorites).values({
        userId,
        restaurantId: restaurantId || null,
        foodId: foodId || null
    });

    return SuccessResponse(res, { isFavorite: true });
};

// ==========================================
// 6. جلب قائمة المفضلة ليوزر معين (Wishlist)
// ==========================================
export const getUserFavorites = async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const restaurantId = req.query.restaurantId as string | undefined;

    const conditions = [eq(favorites.userId, userId)];
    if (restaurantId) {
        conditions.push(eq(favorites.restaurantId, restaurantId));
    }

    const favs = await db.select({
        favoriteId: favorites.id,
        restaurant: {
            id: restaurants.id,
            name: restaurants.name,
            nameAr: restaurants.nameAr,
            nameFr: restaurants.nameFr,
            cover: restaurants.cover,
            logo: restaurants.logo,
            address: restaurants.address,
            addressAr: restaurants.addressAr,
            addressFr: restaurants.addressFr,
        },
        food: {
            id: food.id,
            name: food.name,
            nameAr: food.nameAr,
            nameFr: food.nameFr,
            price: food.price,
            image: food.image,
            isOutOfStock: food.isOutOfStock,
            discountType: food.discount_type,
            discountValue: food.discount_value,
        }
    })
    .from(favorites)
    .leftJoin(restaurants, eq(favorites.restaurantId, restaurants.id))
    .leftJoin(food, eq(favorites.foodId, food.id))
    .where(and(...conditions));

    const uniqueRestaurants = [...new Set(favs.map(f => f.restaurant?.id).filter(Boolean))];
    const discountsByRestaurant = new Map();
    for (const rId of uniqueRestaurants) {
        discountsByRestaurant.set(rId, await getAvailableDiscounts(rId as string));
    }

    const result = {
        restaurants: favs.filter(f => f.restaurant?.id !== null).map(f => f.restaurant),
        foods: favs.filter(f => f.food?.id !== null).map(f => {
            const foodObj = f.food as any;
            const restId = f.restaurant?.id || null;
            const availableDiscounts = restId ? discountsByRestaurant.get(restId) : [];
            const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };

            const { price: finalDiscountPrice, discountNote } = applyPriorityDiscount(
                { id: foodObj.id, discountType: foodObj.discountType, discountValue: foodObj.discountValue },
                Number(foodObj.price),
                0,
                availableDiscounts || [],
                discountState,
                false
            );

            return {
                ...foodObj,
                discountPrice: finalDiscountPrice,
                discountNote,
                discountType: foodObj.discountType,
                discountValue: foodObj.discountValue
            };
        })
    };

    return SuccessResponse(res, { data: result });
};



// export const searchRestaurantWithMenu = async (req: Request, res: Response) => {
//     const { query } = req.query;

//     if (!query || typeof query !== "string") {
//         throw new BadRequest("please enter your search term");
//     }

//     const searchTerm = `%${query}%`;

//     // 1. Fetch flat data
//     const flatResults = await db
//         .select({
//             restaurant: restaurants,
//             food: food,
//             variation: foodVariations,
//             option: variationOptions
//         })
//         .from(restaurants)
//         .leftJoin(
//             food,
//             and(
//                 eq(restaurants.id, food.restaurantid),
//                 eq(food.status, "active")
//             )
//         )
//         .leftJoin(
//             foodVariations,
//             eq(food.id, foodVariations.foodId)
//         )
//         .leftJoin(
//             variationOptions,
//             eq(foodVariations.id, variationOptions.variationId)
//         )
//         .where(
//             and(
//                 eq(restaurants.status, "active"),
//                 or(
//                     like(restaurants.name, searchTerm),
//                     like(restaurants.nameAr, searchTerm),
//                     like(restaurants.nameFr, searchTerm)
//                 )
//             )
//         );

//     // 2. Grouping
//     const restaurantsMap = new Map();

//     for (const row of flatResults) {

//         const r = row.restaurant;
//         const f = row.food;
//         const v = row.variation;
//         const o = row.option;

//         if (!r || !r.id) continue;

//         // Restaurant
//         if (!restaurantsMap.has(r.id)) {

//             restaurantsMap.set(r.id, {
//                 ...r,
//                 food: new Map()
//             });
//         }

//         const currentRestaurant = restaurantsMap.get(r.id);

//         // Food
//         if (f && f.id) {

//             if (!currentRestaurant.food.has(f.id)) {

//                 currentRestaurant.food.set(f.id, {
//                     ...f,
//                     variations: new Map()
//                 });
//             }

//             const currentFood = currentRestaurant.food.get(f.id);

//             // Variation
//             if (v && v.id) {

//                 if (!currentFood.variations.has(v.id)) {

//                     currentFood.variations.set(v.id, {
//                         ...v,
//                         options: []
//                     });
//                 }

//                 const currentVariation =
//                     currentFood.variations.get(v.id);

//                 // Option
//                 if (o && o.id) {

//                     const exists =
//                         currentVariation.options.some(
//                             (opt: any) => opt.id === o.id
//                         );

//                     if (!exists) {
//                         currentVariation.options.push(o);
//                     }
//                 }
//             }
//         }
//     }

//     // 3. Convert Maps → Arrays
//     const formattedData = Array.from(
//         restaurantsMap.values()
//     ).map((restaurant: any) => ({

//         ...restaurant,

//         food: Array.from(
//             restaurant.food.values()
//         ).map((foodItem: any) => ({

//             ...foodItem,

//             variations: Array.from(
//                 foodItem.variations.values()
//             )
//         }))
//     }));

//     return SuccessResponse(res, {
//         message: "Fetched restaurant and menu data successfully",
//         data: formattedData
//     });
// };


// ==========================================
// 7. Search Restaurant With Menu (البحث الذكي الصارم عن المطعم والمنيو)
// ==========================================
export const searchRestaurantWithMenu = async (req: Request, res: Response) => {
    const { query } = req.query;

    if (!query || typeof query !== "string") {
        throw new BadRequest("please enter your search term");
    }

    const cleanQuery = query.trim().toLowerCase();
    const normalizedQuery = cleanQuery.replace(/[-\s'&_]/g, "");
    const searchTerm = `%${cleanQuery}%`;
    const normalizedSearchTerm = `%${normalizedQuery}%`;

    const restaurantConditions = [
        and(sql`${restaurants.name} != ''`, like(restaurants.name, searchTerm)),
        and(sql`${restaurants.nameAr} != ''`, like(restaurants.nameAr, searchTerm)),
        and(sql`${restaurants.nameFr} != ''`, like(restaurants.nameFr, searchTerm)),
        sql`REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${restaurants.name}), '-', ''), ' ', ''), "'", ''), '&', '') = ${normalizedQuery}`,
        sql`REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${restaurants.nameFr}), '-', ''), ' ', ''), "'", ''), '&', '') = ${normalizedQuery}`,
        sql`REPLACE(REPLACE(REPLACE(REPLACE(${restaurants.nameAr}, '-', ''), ' ', ''), "'", ''), '&', '') = ${normalizedQuery}`,
        sql`REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${restaurants.name}), '-', ''), ' ', ''), "'", ''), '&', '') LIKE ${normalizedSearchTerm}`
    ];

    const flatResults = await db
        .select({
            restaurant: restaurants,
            food: food,
            variation: foodVariations,
            option: variationOptions
        })
        .from(restaurants)
        .leftJoin(
            food,
            and(
                eq(restaurants.id, food.restaurantid),
                eq(food.status, "active")
            )
        )
        .leftJoin(foodVariations, eq(food.id, foodVariations.foodId))
        .leftJoin(variationOptions, eq(foodVariations.id, variationOptions.variationId))
        .where(
            and(
                eq(restaurants.status, "active"),
                or(...restaurantConditions) 
            )
        );

    const restaurantsMap = new Map();

    for (const row of flatResults) {
        const r = row.restaurant;
        const f = row.food;
        const v = row.variation;
        const o = row.option;

        if (!r || !r.id) continue;

        if (!restaurantsMap.has(r.id)) {
            restaurantsMap.set(r.id, {
                ...r,
                food: new Map()
            });
        }

        const currentRestaurant = restaurantsMap.get(r.id);

        if (f && f.id) {
            if (!currentRestaurant.food.has(f.id)) {
                currentRestaurant.food.set(f.id, {
                    ...f,
                    variations: new Map()
                });
            }

            const currentFood = currentRestaurant.food.get(f.id);

            if (v && v.id) {
                if (!currentFood.variations.has(v.id)) {
                    currentFood.variations.set(v.id, {
                        ...v,
                        options: []
                    });
                }

                const currentVariation = currentFood.variations.get(v.id);

                if (o && o.id) {
                    const exists = currentVariation.options.some(
                        (opt: any) => opt.id === o.id
                    );

                    if (!exists) {
                        currentVariation.options.push(o);
                    }
                }
            }
        }
    }

    const allRestaurants = Array.from(restaurantsMap.keys());
    const discountsByRestaurant = new Map();
    for (const rId of allRestaurants) {
        discountsByRestaurant.set(rId, await getAvailableDiscounts(rId));
    }

    // ==========================================
    // حساب الفروع غير المتاحة لكل وجبة في نتائج البحث
    // ==========================================
    const allSearchFoods = Array.from(restaurantsMap.values()).flatMap(
        (r: any) => Array.from(r.food.values()) as any[]
    );

    const searchActiveFoodIds = allSearchFoods
        .filter((f: any) => f.status === "active" && !f.isOutOfStock)
        .map((f: any) => f.id)
        .filter(Boolean) as string[];

    const searchUnavailableBranchesMap = searchActiveFoodIds.length > 0
        ? await getUnavailableBranchesForFoods(searchActiveFoodIds)
        : new Map<string, string[]>();

    const formattedData = Array.from(restaurantsMap.values()).map((restaurant: any) => {
        const availableDiscounts = discountsByRestaurant.get(restaurant.id) || [];

        return {
            ...restaurant,
            food: Array.from(restaurant.food.values()).map((foodItem: any) => {
                const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };
                
                const { price: finalDiscountPrice, discountNote } = applyPriorityDiscount(
                    { id: foodItem.id, discountType: foodItem.discount_type, discountValue: foodItem.discount_value },
                    Number(foodItem.price),
                    0,
                    availableDiscounts,
                    discountState,
                    false
                );

                // إذا كانت الوجبة isOutOfStock أو غير active → غير متاحة في جميع الفروع
                const isGloballyUnavailable = foodItem.status !== "active" || foodItem.isOutOfStock;
                const unavailableBranches: string[] | null = isGloballyUnavailable
                    ? null
                    : (searchUnavailableBranchesMap.get(foodItem.id) ?? []);

                return {
                    ...foodItem,
                    discountPrice: finalDiscountPrice,
                    discountNote,
                    variations: Array.from(foodItem.variations.values()),
                    unavailableBranches
                };
            })
        };
    });

    return SuccessResponse(res, {
        message: "Fetched restaurant and menu data successfully",
        data: formattedData
    });
};