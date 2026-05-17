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
        image: schema_1.cuisines.Image
    }).from(schema_1.cuisines).where((0, drizzle_orm_1.eq)(schema_1.cuisines.status, "active"));
    const activeCategories = await connection_1.db.select({
        id: schema_1.categories.id,
        name: schema_1.categories.name,
        image: schema_1.categories.Image
    }).from(schema_1.categories).where((0, drizzle_orm_1.eq)(schema_1.categories.status, "active"));
    const restaurantsData = await connection_1.db.select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        cover: schema_1.restaurants.cover,
        logo: schema_1.restaurants.logo,
        address: schema_1.restaurants.address,
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
        cover: schema_1.restaurants.cover,
        logo: schema_1.restaurants.logo,
        address: schema_1.restaurants.address,
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
        foodImage: schema_1.food.image,
        price: schema_1.food.price,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
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
    const { password, ...safeRestaurantInfo } = restaurantInfo;
    const restaurantWithFav = {
        ...safeRestaurantInfo,
        isFavorite: userId ? favoriteRestaurantIds.has(restaurantId) : false
    };
    const rawMenu = await connection_1.db.select({
        foodId: schema_1.food.id,
        foodName: schema_1.food.name,
        description: schema_1.food.description,
        price: schema_1.food.price,
        image: schema_1.food.image,
        categoryName: schema_1.categories.name,
        variationId: schema_1.foodVariations.id,
        variationName: schema_1.foodVariations.name,
        isRequired: schema_1.foodVariations.isRequired,
        selectionType: schema_1.foodVariations.selectionType,
        min: schema_1.foodVariations.min,
        max: schema_1.foodVariations.max,
        optionId: schema_1.variationOptions.id,
        optionName: schema_1.variationOptions.optionName,
        additionalPrice: schema_1.variationOptions.additionalPrice
    })
        .from(schema_1.food)
        .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
        .leftJoin(schema_1.foodVariations, (0, drizzle_orm_1.eq)(schema_1.food.id, schema_1.foodVariations.foodId))
        .leftJoin(schema_1.variationOptions, (0, drizzle_orm_1.eq)(schema_1.foodVariations.id, schema_1.variationOptions.variationId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId), (0, drizzle_orm_1.eq)(schema_1.food.status, "active")));
    const groupedMenuObj = rawMenu.reduce((acc, row) => {
        const catName = row.categoryName || "Other";
        if (!acc[catName])
            acc[catName] = {};
        if (!acc[catName][row.foodId]) {
            acc[catName][row.foodId] = {
                id: row.foodId,
                name: row.foodName,
                description: row.description,
                price: row.price,
                image: row.image,
                isFavorite: userId ? favoriteFoodIds.has(row.foodId) : false,
                variations: {}
            };
        }
        if (row.variationId) {
            if (!acc[catName][row.foodId].variations[row.variationId]) {
                acc[catName][row.foodId].variations[row.variationId] = {
                    id: row.variationId,
                    name: row.variationName,
                    isRequired: row.isRequired,
                    selectionType: row.selectionType,
                    min: row.min,
                    max: row.max,
                    options: []
                };
            }
            if (row.optionId) {
                acc[catName][row.foodId].variations[row.variationId].options.push({
                    id: row.optionId,
                    name: row.optionName,
                    additionalPrice: row.additionalPrice
                });
            }
        }
        return acc;
    }, {});
    const finalMenu = {};
    for (const [category, foodsObj] of Object.entries(groupedMenuObj)) {
        finalMenu[category] = Object.values(foodsObj).map((f) => {
            f.variations = Object.values(f.variations);
            return f;
        });
    }
    return (0, response_1.SuccessResponse)(res, {
        data: {
            restaurant: restaurantWithFav,
            menu: finalMenu
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
            cover: schema_1.restaurants.cover,
            logo: schema_1.restaurants.logo,
            address: schema_1.restaurants.address,
        },
        // بيانات الأكلة (ستكون null لو كان السجل يخص مطعم)
        food: {
            id: schema_1.food.id,
            name: schema_1.food.name,
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
const searchRestaurantWithMenu = async (req, res) => {
    const { query } = req.query;
    if (!query || typeof query !== "string") {
        throw new Errors_1.BadRequest("من فضلك أدخل كلمة البحث");
    }
    const searchTerm = `%${query}%`;
    // 1. Fetch flat data
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
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"), (0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.restaurants.name, searchTerm), (0, drizzle_orm_1.like)(schema_1.restaurants.nameAr, searchTerm), (0, drizzle_orm_1.like)(schema_1.restaurants.nameFr, searchTerm))));
    // 2. Grouping
    const restaurantsMap = new Map();
    for (const row of flatResults) {
        const r = row.restaurant;
        const f = row.food;
        const v = row.variation;
        const o = row.option;
        if (!r || !r.id)
            continue;
        // Restaurant
        if (!restaurantsMap.has(r.id)) {
            restaurantsMap.set(r.id, {
                ...r,
                food: new Map()
            });
        }
        const currentRestaurant = restaurantsMap.get(r.id);
        // Food
        if (f && f.id) {
            if (!currentRestaurant.food.has(f.id)) {
                currentRestaurant.food.set(f.id, {
                    ...f,
                    variations: new Map()
                });
            }
            const currentFood = currentRestaurant.food.get(f.id);
            // Variation
            if (v && v.id) {
                if (!currentFood.variations.has(v.id)) {
                    currentFood.variations.set(v.id, {
                        ...v,
                        options: []
                    });
                }
                const currentVariation = currentFood.variations.get(v.id);
                // Option
                if (o && o.id) {
                    const exists = currentVariation.options.some((opt) => opt.id === o.id);
                    if (!exists) {
                        currentVariation.options.push(o);
                    }
                }
            }
        }
    }
    // 3. Convert Maps → Arrays
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
