"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserFavorites = exports.toggleFavorite = exports.getRestaurantDetails = exports.getFoodsByCategory = exports.getRestaurantsByCuisine = exports.getHomeScreen = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
// ==========================================
// 1. API شاشة الهوم (Home Screen)
// بيجيب المطابخ، الفئات، والمطاعم في Request واحد عشان السرعة
// ==========================================
const getHomeScreen = async (req, res) => {
    // 1. جلب المطابخ النشطة
    const activeCuisines = await connection_1.db.select({
        id: schema_1.cuisines.id,
        name: schema_1.cuisines.name,
        image: schema_1.cuisines.Image
    }).from(schema_1.cuisines).where((0, drizzle_orm_1.eq)(schema_1.cuisines.status, "active"));
    // 2. جلب الفئات النشطة
    const activeCategories = await connection_1.db.select({
        id: schema_1.categories.id,
        name: schema_1.categories.name,
        image: schema_1.categories.Image
    }).from(schema_1.categories).where((0, drizzle_orm_1.eq)(schema_1.categories.status, "active"));
    // 3. جلب المطاعم (ممكن تحدد limit أو تعتمد على zoneId لليوزر)
    const popularRestaurants = await connection_1.db.select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        cover: schema_1.restaurants.cover,
        logo: schema_1.restaurants.logo,
        address: schema_1.restaurants.address,
        minDeliveryTime: schema_1.restaurants.minDeliveryTime,
    }).from(schema_1.restaurants).where((0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"));
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
// 2. الفلترة بالمطبخ (لما يدوس على Turkish مثلاً)
// ==========================================
const getRestaurantsByCuisine = async (req, res) => {
    const { cuisineId } = req.params;
    const cuisineRestaurants = await connection_1.db.select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        cover: schema_1.restaurants.cover,
        logo: schema_1.restaurants.logo,
        address: schema_1.restaurants.address,
        minDeliveryTime: schema_1.restaurants.minDeliveryTime,
    }).from(schema_1.restaurants)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurants.cuisineId, cuisineId), (0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active")));
    return (0, response_1.SuccessResponse)(res, { data: cuisineRestaurants });
};
exports.getRestaurantsByCuisine = getRestaurantsByCuisine;
// ==========================================
// 3. الفلترة بالفئة (لما يدوس على Shawerma مثلاً)
// بيجيب الأكلات من الفئة دي ومعاها بيانات المطعم اللي بيقدمها
// ==========================================
const getFoodsByCategory = async (req, res) => {
    const { categoryId } = req.params;
    const categoryFoods = await connection_1.db.select({
        foodId: schema_1.food.id,
        foodName: schema_1.food.name,
        foodImage: schema_1.food.image,
        price: schema_1.food.price,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
        restaurantLogo: schema_1.restaurants.logo
    }).from(schema_1.food)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.categoryid, categoryId), (0, drizzle_orm_1.eq)(schema_1.food.status, "active")));
    return (0, response_1.SuccessResponse)(res, { data: categoryFoods });
};
exports.getFoodsByCategory = getFoodsByCategory;
// ==========================================
// 4. صفحة المطعم والمنيو (لما يدوس على مطعم معين)
// ==========================================
const getRestaurantDetails = async (req, res) => {
    const { restaurantId } = req.params;
    // 1. بيانات المطعم
    const [restaurantInfo] = await connection_1.db.select().from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId)).limit(1);
    if (!restaurantInfo)
        throw new Error("المطعم غير موجود");
    // 2. منيو المطعم (بنجيب الأكل ونعمله Join مع الفئات عشان نعرض اسم الفئة)
    const restaurantMenu = await connection_1.db.select({
        foodId: schema_1.food.id,
        foodName: schema_1.food.name,
        description: schema_1.food.description,
        price: schema_1.food.price,
        image: schema_1.food.image,
        foodType: schema_1.food.foodtype,
        categoryId: schema_1.categories.id,
        categoryName: schema_1.categories.name
    }).from(schema_1.food)
        .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId), (0, drizzle_orm_1.eq)(schema_1.food.status, "active")));
    // 💡 تريكة للفرونت إند: نجمع الأكل جوه أقسامه عشان يظهر متصنف في الشاشة
    const groupedMenu = restaurantMenu.reduce((acc, item) => {
        const catName = item.categoryName || "أخرى";
        if (!acc[catName])
            acc[catName] = [];
        acc[catName].push(item);
        return acc;
    }, {});
    return (0, response_1.SuccessResponse)(res, {
        data: {
            restaurant: restaurantInfo,
            menu: groupedMenu // هيرجعلك JSON الأكل متقسم: { "Shawerma": [...], "Meals": [...] }
        }
    });
};
exports.getRestaurantDetails = getRestaurantDetails;
// ==========================================
// 5. إضافة/إزالة المطعم من المفضلة (زرار القلب)
// ==========================================
const toggleFavorite = async (req, res) => {
    try {
        if (!req.user)
            throw new Errors_1.UnauthorizedError("Unauthenticated");
        const userId = req.user.id;
        const { restaurantId, foodId } = req.body;
        if (!restaurantId && !foodId) {
            throw new Errors_1.BadRequest("Restaurant ID or Food ID is required");
        }
        if (restaurantId && foodId) {
            throw new Errors_1.BadRequest("Send only one of restaurantId or foodId");
        }
        // بناء الشرط بناءً على النوع
        const condition = restaurantId
            ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId), (0, drizzle_orm_1.eq)(schema_1.favorites.restaurantId, restaurantId))
            : (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId), (0, drizzle_orm_1.eq)(schema_1.favorites.foodId, foodId));
        // الخطأ بيحصل في السطر ده 👇
        const existingFav = await connection_1.db.select().from(schema_1.favorites).where(condition).limit(1);
        if (existingFav[0]) {
            await connection_1.db.delete(schema_1.favorites).where((0, drizzle_orm_1.eq)(schema_1.favorites.id, existingFav[0].id));
            return (0, response_1.SuccessResponse)(res, { message: "تمت الإزالة من المفضلة", isFavorite: false });
        }
        else {
            await connection_1.db.insert(schema_1.favorites).values({
                userId,
                restaurantId: restaurantId ? restaurantId : null,
                foodId: foodId ? foodId : null
            });
            return (0, response_1.SuccessResponse)(res, { message: "تمت الإضافة للمفضلة", isFavorite: true });
        }
    }
    catch (error) {
        // السطر ده هيقولنا مين العمود أو الجدول اللي مش موجود
        console.error("🔥🔥 MYSQL SELECT ERROR: ", error);
        throw error;
    }
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
