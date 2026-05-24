import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cuisines, categories, restaurants, food, favorites, foodVariations, variationOptions } from "../../models/schema";
import { eq, and, like, or, sql } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, UnauthorizedError } from "../../Errors";

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

    const result = data.map(f => ({
        ...f,
        isFavorite: userId ? favoriteFoodIds.has(f.foodId) : false
    }));

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
        image: food.image,
        
        // 👇 تم إضافة الـ ID واللغات الثلاثة للكاتيجوري
        categoryId: categories.id,
        categoryName: categories.name,
        categoryNameAr: categories.nameAr,
        categoryNameFr: categories.nameFr,
        
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
        additionalPrice: variationOptions.additionalPrice
    })
    .from(food)
    .leftJoin(categories, eq(food.categoryid, categories.id))
    .leftJoin(foodVariations, eq(food.id, foodVariations.foodId))
    .leftJoin(variationOptions, eq(foodVariations.id, variationOptions.variationId))
    .where(and(
        eq(food.restaurantid, restaurantId),
        eq(food.status, "active")
    ));

    // 👇 تجميع الداتا بناءً على الـ Category ID بدلاً من الاسم
    const groupedMenuObj = rawMenu.reduce((acc: any, row) => {
        const catId = row.categoryId || "uncategorized";

        // 1. تجميع الكاتيجوري
        if (!acc[catId]) {
            acc[catId] = {
                id: catId === "uncategorized" ? null : catId,
                name: row.categoryName || "Other",
                nameAr: row.categoryNameAr || "أخرى",
                nameFr: row.categoryNameFr || "Autre",
                foods: {} // هنجمع الأكل هنا كـ Object مؤقتاً
            };
        }

        // 2. تجميع الأكل داخل الكاتيجوري
        if (row.foodId) {
            if (!acc[catId].foods[row.foodId]) {
                acc[catId].foods[row.foodId] = {
                    id: row.foodId,
                    name: row.foodName,
                    nameAr: row.foodNameAr,
                    nameFr: row.foodNameFr,
                    description: row.description,
                    descriptionAr: row.descriptionAr,
                    descriptionFr: row.descriptionFr,
                    price: row.price,
                    image: row.image,
                    isFavorite: userId ? favoriteFoodIds.has(row.foodId) : false,
                    variations: {}
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
                        options: []
                    };
                }

                // 4. تجميع الـ Options داخل الـ Variations
                if (row.optionId) {
                    acc[catId].foods[row.foodId].variations[row.variationId].options.push({
                        id: row.optionId,
                        name: row.optionName,
                        nameAr: row.optionNameAr,
                        nameFr: row.optionNameFr,
                        additionalPrice: row.additionalPrice
                    });
                }
            }
        }

        return acc;
    }, {});

    // 👇 تحويل الكاتيجوريز والأكلات من Objects إلى Arrays عشان الـ Response يكون مظبوط
    const finalMenu = Object.values(groupedMenuObj).map((category: any) => {
        return {
            id: category.id,
            name: category.name,
            nameAr: category.nameAr,
            nameFr: category.nameFr,
            foods: Object.values(category.foods).map((f: any) => {
                f.variations = Object.values(f.variations);
                return f;
            })
        };
    });

    return SuccessResponse(res, {
        data: {
            restaurant: restaurantWithFav,
            menu: finalMenu
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
    // 1. التحقق من تسجيل الدخول
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;

    // 2. جلب البيانات مع عمل Join لجدول المطاعم وجدول الأكلات
    // ملاحظة: تأكد من استيراد جداول (restaurants) و (foods) في ملفك
    const favs = await db.select({
        favoriteId: favorites.id,
        // بيانات المطعم (ستكون null لو كان السجل يخص أكلة)
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
        // بيانات الأكلة (ستكون null لو كان السجل يخص مطعم)
        food: {
            id: food.id,
            name: food.name,
            nameAr: food.nameAr,
            nameFr: food.nameFr,
            price: food.price,
            image: food.image,
        }
    })
    .from(favorites)
    .leftJoin(restaurants, eq(favorites.restaurantId, restaurants.id))
    .leftJoin(food, eq(favorites.foodId, food.id))
    .where(eq(favorites.userId, userId));

    // 3. تنسيق البيانات (اختياري): لفصل المطاعم عن الأكلات في الـ Response
    const result = {
        restaurants: favs.filter(f => f.restaurant?.id !== null).map(f => f.restaurant),
        foods: favs.filter(f => f.food?.id !== null).map(f => f.food)
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
// 2. Search Restaurant With Menu (البحث الدقيق وحل مشكلة جلب مطاعم عشوائية)
// ==========================================
export const searchRestaurantWithMenu = async (req: Request, res: Response) => {
    const { query } = req.query;

    if (!query || typeof query !== "string") {
        throw new BadRequest("please enter your search term");
    }

    const cleanQuery = query.trim().toLowerCase();
    const normalizedQuery = cleanQuery.replace(/[-\s]/g, ""); // تحويل "mataam-wast-albalad" إلى "mataamwastalbalad"
    const searchTerm = `%${cleanQuery}%`;
    const normalizedSearchTerm = `%${normalizedQuery}%`;

    // بناء شروط دقيقة ومباشرة تمنع تماماً الحقول الفارغة والـ Position العشوائي
    const restaurantConditions = [
        // 1. تطابق عبر الـ LIKE العادي (بشرط ألا يكون الحقل فارغاً)
        and(sql`${restaurants.name} != ''`, like(restaurants.name, searchTerm)),
        and(sql`${restaurants.nameAr} != ''`, like(restaurants.nameAr, searchTerm)),
        and(sql`${restaurants.nameFr} != ''`, like(restaurants.nameFr, searchTerm)),

        // 2. التطابق الذكي بعد إزالة المسافات والشرطات (الحل المثالي للـ Slugs)
        sql`REPLACE(REPLACE(LOWER(${restaurants.name}), '-', ''), ' ', '') = ${normalizedQuery}`,
        sql`REPLACE(REPLACE(LOWER(${restaurants.nameFr}), '-', ''), ' ', '') = ${normalizedQuery}`,
        sql`REPLACE(REPLACE(${restaurants.nameAr}, '-', ''), ' ', '') = ${normalizedQuery}`,

        // 3. احتياطياً: لو الـ Slug جزء من اسم طويل مخزن في الداتا بيز
        sql`REPLACE(REPLACE(LOWER(${restaurants.name}), '-', ''), ' ', '') LIKE ${normalizedSearchTerm}`
    ];

    // جلب البيانات بناءً على شروط اسم المطعم الصارمة فقط
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
                or(...restaurantConditions) // تطبيق الفلترة الصارمة
            )
        );

    // تجميع البيانات (Grouping Logic)
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

    const formattedData = Array.from(restaurantsMap.values()).map((restaurant: any) => ({
        ...restaurant,
        food: Array.from(restaurant.food.values()).map((foodItem: any) => ({
            ...foodItem,
            variations: Array.from(foodItem.variations.values())
        }))
    }));

    return SuccessResponse(res, {
        message: "Fetched restaurant and menu data successfully",
        data: formattedData
    });
};