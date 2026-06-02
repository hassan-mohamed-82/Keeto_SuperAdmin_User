import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cuisines, categories, restaurants, food, favorites, foodVariations, variationOptions, addons, adonescategory, subcategories } from "../../models/schema";
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
                    
                    variations: {}, // تجميع الـ Variations
                    addons: {}, // تجميع الـ Addons
                    
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
                        options: {} // 👈 خلينا الـ options Object لمنع التكرار
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
// 2. Search Restaurant With Menu (البحث الذكي الصارم عن المطعم والمنيو)
// ==========================================
export const searchRestaurantWithMenu = async (req: Request, res: Response) => {
    const { query } = req.query;

    if (!query || typeof query !== "string") {
        throw new BadRequest("please enter your search term");
    }

    // 1. تنظيف وتوحيد نص البحث المرسل (حذف الشرطات، المسافات، وعلامة ')
    const cleanQuery = query.trim().toLowerCase();
    const normalizedQuery = cleanQuery.replace(/[-\s']/g, ""); // يحول "mataam-wast-albalad" إلى "mataamwastalbalad"
    const searchTerm = `%${cleanQuery}%`;
    const normalizedSearchTerm = `%${normalizedQuery}%`;

    // 2. بناء شروط دقيقة تطهر بيانات قاعدة البيانات من الفواصل والعلامات أثناء المقارنة
    const restaurantConditions = [
        // أ) تطابق عبر الـ LIKE العادي (بشرط ألا يكون الحقل فارغاً منقوعاً)
        and(sql`${restaurants.name} != ''`, like(restaurants.name, searchTerm)),
        and(sql`${restaurants.nameAr} != ''`, like(restaurants.nameAr, searchTerm)),
        and(sql`${restaurants.nameFr} != ''`, like(restaurants.nameFr, searchTerm)),

        // ب) التطابق التام الذكي بعد تنظيف (المسافات، الشرطات، وعلامة ') - حل مشكلة الـ Slugs والأبوستروف
        sql`REPLACE(REPLACE(REPLACE(LOWER(${restaurants.name}), '-', ''), ' ', ''), "'", '') = ${normalizedQuery}`,
        sql`REPLACE(REPLACE(REPLACE(LOWER(${restaurants.nameFr}), '-', ''), ' ', ''), "'", '') = ${normalizedQuery}`,
        sql`REPLACE(REPLACE(REPLACE(${restaurants.nameAr}, '-', ''), ' ', ''), "'", '') = ${normalizedQuery}`,

        // ج) احتياطياً: في حال كان الـ Slug جزءاً من اسم أطول مخزن في قاعدة البيانات
        sql`REPLACE(REPLACE(REPLACE(LOWER(${restaurants.name}), '-', ''), ' ', ''), "'", '') LIKE ${normalizedSearchTerm}`
    ];

    // 3. جلب البيانات بناءً على شروط اسم المطعم الصارمة فقط
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
                or(...restaurantConditions) // تطبيق الفلترة الصارمة والذكية هنا
            )
        );

    // 4. تجميع البيانات المجلوبة (Grouping Logic) من جداول مفلطحة إلى شجرة مرابطة
    const restaurantsMap = new Map();

    for (const row of flatResults) {
        const r = row.restaurant;
        const f = row.food;
        const v = row.variation;
        const o = row.option;

        if (!r || !r.id) continue;

        // تجميع المطعم
        if (!restaurantsMap.has(r.id)) {
            restaurantsMap.set(r.id, {
                ...r,
                food: new Map()
            });
        }

        const currentRestaurant = restaurantsMap.get(r.id);

        // تجميع الأكلات (Food)
        if (f && f.id) {
            if (!currentRestaurant.food.has(f.id)) {
                currentRestaurant.food.set(f.id, {
                    ...f,
                    variations: new Map()
                });
            }

            const currentFood = currentRestaurant.food.get(f.id);

            // تجميع الأحجام/الأنواع (Variations)
            if (v && v.id) {
                if (!currentFood.variations.has(v.id)) {
                    currentFood.variations.set(v.id, {
                        ...v,
                        options: []
                    });
                }

                const currentVariation = currentFood.variations.get(v.id);

                // تجميع الخيارات الإضافية (Options)
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

    // 5. تحويل الـ Maps إلى Arrays ليكون الـ Response جاهزاً ونظيفاً للفرونت إند
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