"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchRestaurantWithMenu = exports.getUserFavorites = exports.toggleFavorite = exports.getRestaurantDetails = exports.getFoodsByCategory = exports.getRestaurantsByCuisine = exports.getHomeScreen = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
// ==========================================
// 🔥 Helper: تجهيز favorites لو اليوزر عامل login
// ==========================================
const getUserFavoritesSets = async (userId) => {
    const favoriteRestaurantIds = new Set();
    const favoriteFoodIds = new Set();
    if (!userId)
        return { favoriteRestaurantIds, favoriteFoodIds };
    const userFavorites = await connection_1.db
        .select()
        .from(schema_1.favorites)
        .where((0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId));
    userFavorites.forEach(f => {
        if (f.restaurantId)
            favoriteRestaurantIds.add(f.restaurantId);
        if (f.foodId)
            favoriteFoodIds.add(f.foodId);
    });
    return { favoriteRestaurantIds, favoriteFoodIds };
};
// ==========================================
// 1. Home Screen
// ==========================================
const getHomeScreen = async (req, res) => {
    const userId = req.user?.id;
    const { favoriteRestaurantIds } = await getUserFavoritesSets(userId);
    const activeCuisines = await connection_1.db.select({
        id: schema_1.cuisines.id,
        name: schema_1.cuisines.name,
        nameAr: schema_1.cuisines.nameAr,
        nameFr: schema_1.cuisines.nameFr,
        image: schema_1.cuisines.Image
    }).from(schema_1.cuisines).where((0, drizzle_orm_1.eq)(schema_1.cuisines.status, "active"));
    const activeCategories = await connection_1.db.select({
        id: schema_1.categories.id,
        name: schema_1.categories.name,
        nameAr: schema_1.categories.nameAr,
        nameFr: schema_1.categories.nameFr,
        image: schema_1.categories.Image
    }).from(schema_1.categories).where((0, drizzle_orm_1.eq)(schema_1.categories.status, "active"));
    const restaurantsData = await connection_1.db.select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        nameFr: schema_1.restaurants.nameFr,
        cover: schema_1.restaurants.cover,
        logo: schema_1.restaurants.logo,
        address: schema_1.restaurants.address,
        addressAr: schema_1.restaurants.addressAr,
        addressFr: schema_1.restaurants.addressFr,
        minDeliveryTime: schema_1.restaurants.minDeliveryTime,
    }).from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"));
    const popularRestaurants = restaurantsData.map(r => ({
        ...r,
        isFavorite: userId ? favoriteRestaurantIds.has(r.id) : false
    }));
    return (0, response_1.SuccessResponse)(res, {
        data: {
            cuisines: activeCuisines,
            categories: activeCategories,
            restaurants: popularRestaurants
        }
    });
};
exports.getHomeScreen = getHomeScreen;
// ==========================================
// 2. Restaurants by Cuisine
// ==========================================
const getRestaurantsByCuisine = async (req, res) => {
    const { cuisineId } = req.params;
    const userId = req.user?.id;
    const { favoriteRestaurantIds } = await getUserFavoritesSets(userId);
    const data = await connection_1.db.select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        nameFr: schema_1.restaurants.nameFr,
        cover: schema_1.restaurants.cover,
        logo: schema_1.restaurants.logo,
        address: schema_1.restaurants.address,
        addressAr: schema_1.restaurants.addressAr,
        addressFr: schema_1.restaurants.addressFr,
        minDeliveryTime: schema_1.restaurants.minDeliveryTime,
    }).from(schema_1.restaurants)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `JSON_CONTAINS(${schema_1.restaurants.cuisineId}, ${JSON.stringify(cuisineId)})`));
    const result = data.map(r => ({
        ...r,
        isFavorite: userId ? favoriteRestaurantIds.has(r.id) : false
    }));
    return (0, response_1.SuccessResponse)(res, { data: result });
};
exports.getRestaurantsByCuisine = getRestaurantsByCuisine;
// ==========================================
// 3. Foods by Category
// ==========================================
const getFoodsByCategory = async (req, res) => {
    const { categoryId } = req.params;
    const userId = req.user?.id;
    const { favoriteFoodIds } = await getUserFavoritesSets(userId);
    const data = await connection_1.db.select({
        foodId: schema_1.food.id,
        foodName: schema_1.food.name,
        foodNameAr: schema_1.food.nameAr,
        foodNameFr: schema_1.food.nameFr,
        foodImage: schema_1.food.image,
        price: schema_1.food.price,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
        restaurantNameAr: schema_1.restaurants.nameAr,
        restaurantNameFr: schema_1.restaurants.nameFr,
        restaurantLogo: schema_1.restaurants.logo
    })
        .from(schema_1.food)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.categoryid, categoryId), (0, drizzle_orm_1.eq)(schema_1.food.status, "active")));
    const result = data.map(f => ({
        ...f,
        isFavorite: userId ? favoriteFoodIds.has(f.foodId) : false
    }));
    return (0, response_1.SuccessResponse)(res, { data: result });
};
exports.getFoodsByCategory = getFoodsByCategory;
// ==========================================
// 4. Restaurant Details + Menu
// ==========================================
const getRestaurantDetails = async (req, res) => {
    const { restaurantId } = req.params;
    const userId = req.user?.id;
    const { favoriteFoodIds, favoriteRestaurantIds } = await getUserFavoritesSets(userId);
    const [restaurantInfo] = await connection_1.db.select().from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId));
    if (!restaurantInfo)
        throw new Error("Restaurant not found");
    const { ...safeRestaurantInfo } = restaurantInfo;
    const restaurantWithFav = {
        ...safeRestaurantInfo,
        isFavorite: userId ? favoriteRestaurantIds.has(restaurantId) : false
    };
    const rawMenu = await connection_1.db.select({
        foodId: schema_1.food.id,
        foodName: schema_1.food.name,
        foodNameAr: schema_1.food.nameAr,
        foodNameFr: schema_1.food.nameFr,
        description: schema_1.food.description,
        descriptionAr: schema_1.food.descriptionAr,
        descriptionFr: schema_1.food.descriptionFr,
        price: schema_1.food.price,
        image: schema_1.food.image,
        categoryId: schema_1.categories.id,
        categoryName: schema_1.categories.name,
        categoryNameAr: schema_1.categories.nameAr,
        categoryNameFr: schema_1.categories.nameFr,
        subcategoryId: schema_1.subcategories.id,
        subcategoryName: schema_1.subcategories.name,
        subcategoryNameAr: schema_1.subcategories.nameAr,
        subcategoryNameFr: schema_1.subcategories.nameFr,
        order_level: schema_1.subcategories.order_Level,
        variationId: schema_1.foodVariations.id,
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
        addonId: schema_1.addons.id,
        addonName: schema_1.addons.name,
        addonNameAr: schema_1.addons.nameAr,
        addonNameFr: schema_1.addons.nameFr,
        addonPrice: schema_1.addons.price,
        addonStatus: schema_1.addons.status,
        addonStockType: schema_1.addons.stock_type,
        addonRestaurantId: schema_1.addons.restaurantid,
        addonCreatedAt: schema_1.addons.createdAt,
        addonUpdatedAt: schema_1.addons.updatedAt,
        addonCategoryId: schema_1.adonescategory.id,
        addonCategoryName: schema_1.adonescategory.name,
        addonCategoryNameAr: schema_1.adonescategory.nameAr,
        addonCategoryNameFr: schema_1.adonescategory.nameFr,
    })
        .from(schema_1.food)
        .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
        .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
        .leftJoin(schema_1.foodVariations, (0, drizzle_orm_1.eq)(schema_1.food.id, schema_1.foodVariations.foodId))
        .leftJoin(schema_1.variationOptions, (0, drizzle_orm_1.eq)(schema_1.foodVariations.id, schema_1.variationOptions.variationId))
        .leftJoin(schema_1.addons, (0, drizzle_orm_1.sql) `JSON_CONTAINS(${schema_1.food.addonsId}, JSON_QUOTE(${schema_1.addons.id}))`)
        .leftJoin(schema_1.adonescategory, (0, drizzle_orm_1.eq)(schema_1.addons.adonescategoryid, schema_1.adonescategory.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId), (0, drizzle_orm_1.eq)(schema_1.food.status, "active")));
    const groupedMenuObj = rawMenu.reduce((acc, row) => {
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
                    variations: {},
                    addons: {}, // 👈 تم التعديل: تجميع الـ Addons في أوبجيكت مستقل عشان نمنع التكرار
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
            // 5. 👈 تم التعديل: تجميع الـ Addons بشكل صحيح
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
    // 👇 تم التعديل: تحويل الـ Variations والـ Addons من Objects إلى Arrays
    const finalMenu = Object.values(groupedMenuObj).map((category) => {
        return {
            id: category.id,
            name: category.name,
            nameAr: category.nameAr,
            nameFr: category.nameFr,
            foods: Object.values(category.foods).map((f) => {
                f.variations = Object.values(f.variations);
                f.addons = Object.values(f.addons); // 👈 دي الخطوة اللي هتطلع الـ Addons في الـ Response كـ Array
                return f;
            })
        };
    });
    // ==========================================
    // جلب الـ Addons مع الـ Categories (نفس الكود بتاعك بدون تغيير)
    // ==========================================
    const rawAddons = await connection_1.db.select({
        addonId: schema_1.addons.id,
        addonName: schema_1.addons.name,
        addonNameAr: schema_1.addons.nameAr,
        addonNameFr: schema_1.addons.nameFr,
        addonPrice: schema_1.addons.price,
        addonStockType: schema_1.addons.stock_type,
        categoryId: schema_1.adonescategory.id,
        categoryName: schema_1.adonescategory.name,
        categoryNameAr: schema_1.adonescategory.nameAr,
        categoryNameFr: schema_1.adonescategory.nameFr,
    })
        .from(schema_1.addons)
        .leftJoin(schema_1.adonescategory, (0, drizzle_orm_1.eq)(schema_1.addons.adonescategoryid, schema_1.adonescategory.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.addons.restaurantid, restaurantId), (0, drizzle_orm_1.eq)(schema_1.addons.status, "active")));
    const groupedAddonsObj = rawAddons.reduce((acc, row) => {
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
    const finalAddons = Object.values(groupedAddonsObj).map((category) => {
        return {
            id: category.id,
            name: category.name,
            nameAr: category.nameAr,
            nameFr: category.nameFr,
            addons: category.addons
        };
    });
    return (0, response_1.SuccessResponse)(res, {
        data: {
            restaurant: restaurantWithFav,
            menu: finalMenu,
            addons: finalAddons
        }
    });
};
exports.getRestaurantDetails = getRestaurantDetails;
// ==========================================
// 5. Toggle Favorite
// ==========================================
const toggleFavorite = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { restaurantId, foodId } = req.body;
    if (!restaurantId && !foodId)
        throw new Errors_1.BadRequest("Restaurant ID or Food ID is required");
    if (restaurantId && foodId)
        throw new Errors_1.BadRequest("Send only one");
    const condition = restaurantId
        ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId), (0, drizzle_orm_1.eq)(schema_1.favorites.restaurantId, restaurantId))
        : (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId), (0, drizzle_orm_1.eq)(schema_1.favorites.foodId, foodId));
    const [existingFav] = await connection_1.db.select().from(schema_1.favorites).where(condition);
    if (existingFav) {
        await connection_1.db.delete(schema_1.favorites).where((0, drizzle_orm_1.eq)(schema_1.favorites.id, existingFav.id));
        return (0, response_1.SuccessResponse)(res, { isFavorite: false });
    }
    await connection_1.db.insert(schema_1.favorites).values({
        userId,
        restaurantId: restaurantId || null,
        foodId: foodId || null
    });
    return (0, response_1.SuccessResponse)(res, { isFavorite: true });
};
exports.toggleFavorite = toggleFavorite;
// ==========================================
// 6. جلب قائمة المفضلة ليوزر معين (Wishlist)
// ==========================================
const getUserFavorites = async (req, res) => {
    // 1. التحقق من تسجيل الدخول
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    // 2. جلب البيانات مع عمل Join لجدول المطاعم وجدول الأكلات
    // ملاحظة: تأكد من استيراد جداول (restaurants) و (foods) في ملفك
    const favs = await connection_1.db.select({
        favoriteId: schema_1.favorites.id,
        // بيانات المطعم (ستكون null لو كان السجل يخص أكلة)
        restaurant: {
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
            nameAr: schema_1.restaurants.nameAr,
            nameFr: schema_1.restaurants.nameFr,
            cover: schema_1.restaurants.cover,
            logo: schema_1.restaurants.logo,
            address: schema_1.restaurants.address,
            addressAr: schema_1.restaurants.addressAr,
            addressFr: schema_1.restaurants.addressFr,
        },
        // بيانات الأكلة (ستكون null لو كان السجل يخص مطعم)
        food: {
            id: schema_1.food.id,
            name: schema_1.food.name,
            nameAr: schema_1.food.nameAr,
            nameFr: schema_1.food.nameFr,
            price: schema_1.food.price,
            image: schema_1.food.image,
        }
    })
        .from(schema_1.favorites)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.favorites.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.favorites.foodId, schema_1.food.id))
        .where((0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId));
    // 3. تنسيق البيانات (اختياري): لفصل المطاعم عن الأكلات في الـ Response
    const result = {
        restaurants: favs.filter(f => f.restaurant?.id !== null).map(f => f.restaurant),
        foods: favs.filter(f => f.food?.id !== null).map(f => f.food)
    };
    return (0, response_1.SuccessResponse)(res, { data: result });
};
exports.getUserFavorites = getUserFavorites;
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
const searchRestaurantWithMenu = async (req, res) => {
    const { query } = req.query;
    if (!query || typeof query !== "string") {
        throw new Errors_1.BadRequest("please enter your search term");
    }
    // 1. تنظيف وتوحيد نص البحث المرسل (حذف الشرطات، المسافات، وعلامة ')
    const cleanQuery = query.trim().toLowerCase();
    const normalizedQuery = cleanQuery.replace(/[-\s']/g, ""); // يحول "mataam-wast-albalad" إلى "mataamwastalbalad"
    const searchTerm = `%${cleanQuery}%`;
    const normalizedSearchTerm = `%${normalizedQuery}%`;
    // 2. بناء شروط دقيقة تطهر بيانات قاعدة البيانات من الفواصل والعلامات أثناء المقارنة
    const restaurantConditions = [
        // أ) تطابق عبر الـ LIKE العادي (بشرط ألا يكون الحقل فارغاً منقوعاً)
        (0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.restaurants.name} != ''`, (0, drizzle_orm_1.like)(schema_1.restaurants.name, searchTerm)),
        (0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.restaurants.nameAr} != ''`, (0, drizzle_orm_1.like)(schema_1.restaurants.nameAr, searchTerm)),
        (0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.restaurants.nameFr} != ''`, (0, drizzle_orm_1.like)(schema_1.restaurants.nameFr, searchTerm)),
        // ب) التطابق التام الذكي بعد تنظيف (المسافات، الشرطات، وعلامة ') - حل مشكلة الـ Slugs والأبوستروف
        (0, drizzle_orm_1.sql) `REPLACE(REPLACE(REPLACE(LOWER(${schema_1.restaurants.name}), '-', ''), ' ', ''), "'", '') = ${normalizedQuery}`,
        (0, drizzle_orm_1.sql) `REPLACE(REPLACE(REPLACE(LOWER(${schema_1.restaurants.nameFr}), '-', ''), ' ', ''), "'", '') = ${normalizedQuery}`,
        (0, drizzle_orm_1.sql) `REPLACE(REPLACE(REPLACE(${schema_1.restaurants.nameAr}, '-', ''), ' ', ''), "'", '') = ${normalizedQuery}`,
        // ج) احتياطياً: في حال كان الـ Slug جزءاً من اسم أطول مخزن في قاعدة البيانات
        (0, drizzle_orm_1.sql) `REPLACE(REPLACE(REPLACE(LOWER(${schema_1.restaurants.name}), '-', ''), ' ', ''), "'", '') LIKE ${normalizedSearchTerm}`
    ];
    // 3. جلب البيانات بناءً على شروط اسم المطعم الصارمة فقط
    const flatResults = await connection_1.db
        .select({
        restaurant: schema_1.restaurants,
        food: schema_1.food,
        variation: schema_1.foodVariations,
        option: schema_1.variationOptions
    })
        .from(schema_1.restaurants)
        .leftJoin(schema_1.food, (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.food.restaurantid), (0, drizzle_orm_1.eq)(schema_1.food.status, "active")))
        .leftJoin(schema_1.foodVariations, (0, drizzle_orm_1.eq)(schema_1.food.id, schema_1.foodVariations.foodId))
        .leftJoin(schema_1.variationOptions, (0, drizzle_orm_1.eq)(schema_1.foodVariations.id, schema_1.variationOptions.variationId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"), (0, drizzle_orm_1.or)(...restaurantConditions) // تطبيق الفلترة الصارمة والذكية هنا
    ));
    // 4. تجميع البيانات المجلوبة (Grouping Logic) من جداول مفلطحة إلى شجرة مرابطة
    const restaurantsMap = new Map();
    for (const row of flatResults) {
        const r = row.restaurant;
        const f = row.food;
        const v = row.variation;
        const o = row.option;
        if (!r || !r.id)
            continue;
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
                    const exists = currentVariation.options.some((opt) => opt.id === o.id);
                    if (!exists) {
                        currentVariation.options.push(o);
                    }
                }
            }
        }
    }
    // 5. تحويل الـ Maps إلى Arrays ليكون الـ Response جاهزاً ونظيفاً للفرونت إند
    const formattedData = Array.from(restaurantsMap.values()).map((restaurant) => ({
        ...restaurant,
        food: Array.from(restaurant.food.values()).map((foodItem) => ({
            ...foodItem,
            variations: Array.from(foodItem.variations.values())
        }))
    }));
    return (0, response_1.SuccessResponse)(res, {
        message: "Fetched restaurant and menu data successfully",
        data: formattedData
    });
};
exports.searchRestaurantWithMenu = searchRestaurantWithMenu;
