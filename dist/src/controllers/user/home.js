"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchRestaurantWithMenu = exports.getUserFavorites = exports.toggleFavorite = exports.getRestaurantDetails = exports.getFoodsByCategory = exports.getRestaurantsByCuisine = exports.getHomeScreen = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const discount_1 = require("../../utils/discount");
const food_helper_1 = require("../../helpers/food.helper");
const foodFormat_1 = require("../../services/foodFormat");
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
        foodDiscountType: schema_1.food.discount_type,
        foodDiscountValue: schema_1.food.discount_value,
        isOutOfStock: schema_1.food.isOutOfStock,
        restaurantId: schema_1.restaurants.id,
        restaurantName: schema_1.restaurants.name,
        restaurantNameAr: schema_1.restaurants.nameAr,
        restaurantNameFr: schema_1.restaurants.nameFr,
        restaurantLogo: schema_1.restaurants.logo
    })
        .from(schema_1.food)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.food.restaurantid, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.categoryid, categoryId), (0, drizzle_orm_1.eq)(schema_1.food.status, "active")));
    const uniqueRestaurants = [...new Set(data.map(f => f.restaurantId))];
    const discountsByRestaurant = new Map();
    for (const rId of uniqueRestaurants) {
        if (rId)
            discountsByRestaurant.set(rId, await (0, discount_1.getAvailableDiscounts)(rId));
    }
    // ==========================================
    // حساب الفروع غير المتاحة لكل وجبة
    // ==========================================
    // الوجبات النشطة فقط (status == active) هي التي وصلت هنا،
    // لكن isOutOfStock ممكن تكون true → غير متاحة في كل الفروع
    const activeFoodIds = data
        .filter(f => !f.isOutOfStock)
        .map(f => f.foodId)
        .filter(Boolean);
    const unavailableBranchesMap = activeFoodIds.length > 0
        ? await (0, food_helper_1.getUnavailableBranchesForFoods)(activeFoodIds)
        : new Map();
    const result = data.map(f => {
        const availableDiscounts = discountsByRestaurant.get(f.restaurantId) || [];
        const discountState = { remainingMaxDiscounts: new Map(), appliedDiscounts: new Set() };
        const { price: finalDiscountPrice, discountNote } = (0, discount_1.applyPriorityDiscount)({ id: f.foodId, discountType: f.foodDiscountType, discountValue: f.foodDiscountValue }, Number(f.price), 0, availableDiscounts, discountState, false);
        // إذا كانت الوجبة isOutOfStock → غير متاحة في جميع الفروع (null)
        // وإلا → قائمة الفروع غير المتاحة بالتحديد
        const unavailableBranches = f.isOutOfStock
            ? null
            : (unavailableBranchesMap.get(f.foodId) ?? []);
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
    return (0, response_1.SuccessResponse)(res, { data: result });
};
exports.getFoodsByCategory = getFoodsByCategory;
// ==========================================
// 4. Restaurant Details + Menu
// ==========================================
const getRestaurantDetails = async (req, res) => {
    const { restaurantId } = req.params;
    const userId = req.user?.id;
    // 1. Fetch User Favorites
    const { favoriteFoodIds, favoriteRestaurantIds } = await getUserFavoritesSets(userId);
    // 2. Fetch Restaurant Info
    const [restaurantInfo] = await connection_1.db
        .select({
        id: schema_1.restaurants.id,
        name: schema_1.restaurants.name,
        nameAr: schema_1.restaurants.nameAr,
        nameFr: schema_1.restaurants.nameFr,
        minDeliveryTime: schema_1.restaurants.minDeliveryTime,
        maxDeliveryTime: schema_1.restaurants.maxDeliveryTime,
        deliveryTimeUnit: schema_1.restaurants.deliveryTimeUnit,
        logo: schema_1.restaurants.logo,
        cover: schema_1.restaurants.cover,
        iosApp: schema_1.restaurants.iosApp,
        androidApp: schema_1.restaurants.androidApp,
    })
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId));
    if (!restaurantInfo) {
        throw new Error("Restaurant not found");
    }
    const restaurantWithFav = {
        ...restaurantInfo,
        isFavorite: userId ? favoriteRestaurantIds.has(restaurantId) : false,
    };
    // 3. Fetch Active Foods and Categories
    const rawMenu = await connection_1.db
        .select({
        foodId: schema_1.food.id,
        foodName: schema_1.food.name,
        foodNameAr: schema_1.food.nameAr,
        foodNameFr: schema_1.food.nameFr,
        description: schema_1.food.description,
        descriptionAr: schema_1.food.descriptionAr,
        descriptionFr: schema_1.food.descriptionFr,
        price: schema_1.food.price,
        foodDiscountType: schema_1.food.discount_type,
        foodDiscountValue: schema_1.food.discount_value,
        isOutOfStock: schema_1.food.isOutOfStock,
        image: schema_1.food.image,
        points: schema_1.food.points,
        addonsId: schema_1.food.addonsId,
        categoryId: schema_1.categories.id,
        categoryName: schema_1.categories.name,
        categoryNameAr: schema_1.categories.nameAr,
        categoryNameFr: schema_1.categories.nameFr,
        subcategoryId: schema_1.subcategories.id,
        subcategoryName: schema_1.subcategories.name,
        subcategoryNameAr: schema_1.subcategories.nameAr,
        subcategoryNameFr: schema_1.subcategories.nameFr,
        order_level: schema_1.subcategories.order_Level,
    })
        .from(schema_1.food)
        .leftJoin(schema_1.categories, (0, drizzle_orm_1.eq)(schema_1.food.categoryid, schema_1.categories.id))
        .leftJoin(schema_1.subcategories, (0, drizzle_orm_1.eq)(schema_1.food.subcategoryid, schema_1.subcategories.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId), (0, drizzle_orm_1.eq)(schema_1.food.status, "active"), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.categories.id), (0, drizzle_orm_1.eq)(schema_1.categories.status, "active")), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.subcategories.id), (0, drizzle_orm_1.eq)(schema_1.subcategories.status, "active"))));
    // 4. Fetch Restaurant General Addons
    const rawAddons = await connection_1.db
        .select({
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
    // Grouping Addons by Category
    const addonsCategoryMap = new Map();
    for (const addon of rawAddons) {
        const catId = addon.categoryId || "uncategorized";
        if (!addonsCategoryMap.has(catId)) {
            addonsCategoryMap.set(catId, {
                id: catId === "uncategorized" ? null : catId,
                name: addon.categoryName || "Other",
                nameAr: addon.categoryNameAr || "أخرى",
                nameFr: addon.categoryNameFr || "Autre",
                addons: []
            });
        }
        addonsCategoryMap.get(catId).addons.push({
            id: addon.addonId,
            name: addon.addonName,
            nameAr: addon.addonNameAr,
            nameFr: addon.addonNameFr,
            price: Number(addon.addonPrice),
            stockType: addon.addonStockType
        });
    }
    if (rawMenu.length === 0) {
        return (0, response_1.SuccessResponse)(res, {
            data: {
                restaurant: restaurantWithFav,
                menu: [],
                addons: Array.from(addonsCategoryMap.values())
            }
        });
    }
    // 5. Format All Foods using formatFoodsList Service
    const formattedFoods = await (0, foodFormat_1.formatFoodsList)(rawMenu, restaurantId, userId, favoriteFoodIds);
    // 6. Group Formatted Foods by Category
    const categoriesMap = new Map();
    for (const foodItem of formattedFoods) {
        const catId = foodItem.category?.id || "uncategorized";
        if (!categoriesMap.has(catId)) {
            categoriesMap.set(catId, {
                id: catId === "uncategorized" ? null : catId,
                name: foodItem.category?.name || "Other",
                nameAr: foodItem.category?.nameAr || "أخرى",
                nameFr: foodItem.category?.nameFr || "Autre",
                foods: []
            });
        }
        categoriesMap.get(catId).foods.push(foodItem);
    }
    return (0, response_1.SuccessResponse)(res, {
        data: {
            restaurant: restaurantWithFav,
            menu: Array.from(categoriesMap.values()),
            addons: Array.from(addonsCategoryMap.values())
        }
    });
};
exports.getRestaurantDetails = getRestaurantDetails;
// export const getRestaurantDetails = async (req: Request, res: Response) => {
//     const { restaurantId } = req.params;
//     const userId = req.user?.id;
//     const { favoriteFoodIds, favoriteRestaurantIds } = await getUserFavoritesSets(userId);
//     const [restaurantInfo] = await db.select({
//         id: restaurants.id,
//         name: restaurants.name,
//         nameAr: restaurants.nameAr,
//         nameFr: restaurants.nameFr,
//         minDeliveryTime: restaurants.minDeliveryTime,
//         maxDeliveryTime: restaurants.maxDeliveryTime,
//         deliveryTimeUnit: restaurants.deliveryTimeUnit,
//         logo: restaurants.logo,
//         cover: restaurants.cover,
//         iosApp: restaurants.iosApp,
//         androidApp: restaurants.androidApp,
//     }).from(restaurants)
//         .where(eq(restaurants.id, restaurantId));
//     if (!restaurantInfo) throw new Error("Restaurant not found");
//     const { ...safeRestaurantInfo } = restaurantInfo;
//     const restaurantWithFav = {
//         ...safeRestaurantInfo,
//         isFavorite: userId ? favoriteRestaurantIds.has(restaurantId) : false
//     };
//     const rawMenu = await db.select({
//         foodId: food.id,
//         foodName: food.name,
//         foodNameAr: food.nameAr,
//         foodNameFr: food.nameFr,
//         description: food.description,
//         descriptionAr: food.descriptionAr,
//         descriptionFr: food.descriptionFr,
//         price: food.price,
//         foodDiscountType: food.discount_type,
//         foodDiscountValue: food.discount_value,
//         isOutOfStock: food.isOutOfStock,
//         image: food.image,
//         points: food.points,
//         categoryId: categories.id,
//         categoryName: categories.name,
//         categoryNameAr: categories.nameAr,
//         categoryNameFr: categories.nameFr,
//         subcategoryId: subcategories.id,
//         subcategoryName: subcategories.name,
//         subcategoryNameAr: subcategories.nameAr,
//         subcategoryNameFr: subcategories.nameFr,
//         order_level: subcategories.order_Level,
//         variationId: foodVariations.id,
//         variationName: foodVariations.name,
//         variationNameAr: foodVariations.nameAr,
//         variationNameFr: foodVariations.nameFr,
//         isRequired: foodVariations.isRequired,
//         selectionType: foodVariations.selectionType,
//         min: foodVariations.min,
//         max: foodVariations.max,
//         optionId: variationOptions.id,
//         optionName: variationOptions.optionName,
//         optionNameAr: variationOptions.optionNameAr,
//         optionNameFr: variationOptions.optionNameFr,
//         additionalPrice: variationOptions.additionalPrice,
//         addonId: addons.id,
//         addonName: addons.name,
//         addonNameAr: addons.nameAr,
//         addonNameFr: addons.nameFr,
//         addonPrice: addons.price,
//         addonStatus: addons.status,
//         addonStockType: addons.stock_type,
//         addonRestaurantId: addons.restaurantid,
//         addonCreatedAt: addons.createdAt,
//         addonUpdatedAt: addons.updatedAt,
//         addonCategoryId: adonescategory.id,
//         addonCategoryName: adonescategory.name,
//         addonCategoryNameAr: adonescategory.nameAr,
//         addonCategoryNameFr: adonescategory.nameFr,
//     })
//         .from(food)
//         .leftJoin(categories, eq(food.categoryid, categories.id))
//         .leftJoin(subcategories, eq(food.subcategoryid, subcategories.id))
//         .leftJoin(foodVariations, eq(food.id, foodVariations.foodId))
//         .leftJoin(variationOptions, eq(foodVariations.id, variationOptions.variationId))
//         .leftJoin(addons, sql`JSON_CONTAINS(${food.addonsId}, JSON_QUOTE(${addons.id}))`)
//         .leftJoin(adonescategory, eq(addons.adonescategoryid, adonescategory.id))
//         .where(and(
//             eq(food.restaurantid, restaurantId),
//             eq(food.status, "active"),
//             or(isNull(categories.id), eq(categories.status, "active")),
//             or(isNull(subcategories.id), eq(subcategories.status, "active"))
//         ));
//     const availableDiscounts = await getAvailableDiscounts(restaurantId);
//     const groupedMenuObj = rawMenu.reduce((acc: any, row) => {
//         const catId = row.categoryId || "uncategorized";
//         // 1. تجميع الكاتيجوري
//         if (!acc[catId]) {
//             acc[catId] = {
//                 id: catId === "uncategorized" ? null : catId,
//                 name: row.categoryName || "Other",
//                 nameAr: row.categoryNameAr || "أخرى",
//                 nameFr: row.categoryNameFr || "Autre",
//                 foods: {}
//             };
//         }
//         // 2. تجميع الأكل داخل الكاتيجوري مع حساب الخصم المباشر
//         if (row.foodId) {
//             if (!acc[catId].foods[row.foodId]) {
//                 const discountState = { remainingMaxDiscounts: new Map<string, number>(), appliedDiscounts: new Set<string>() };
//                 const { price: calculatedDiscountPrice, discountNote } = applyPriorityDiscount(
//                     { id: row.foodId, discountType: row.foodDiscountType, discountValue: row.foodDiscountValue },
//                     Number(row.price),
//                     0,
//                     availableDiscounts,
//                     discountState,
//                     false
//                 );
//                 acc[catId].foods[row.foodId] = {
//                     id: row.foodId,
//                     name: row.foodName,
//                     nameAr: row.foodNameAr,
//                     nameFr: row.foodNameFr,
//                     description: row.description,
//                     descriptionAr: row.descriptionAr,
//                     descriptionFr: row.descriptionFr,
//                     price: Number(row.price),
//                     discountType: row.foodDiscountType ?? null,
//                     discountValue: row.foodDiscountValue !== null ? Number(row.foodDiscountValue) : null,
//                     discountPrice: calculatedDiscountPrice,
//                     discountNote,
//                     image: row.image,
//                     isOutOfStock: row.isOutOfStock,
//                     points: userId ? row.points : null,
//                     isFavorite: userId ? favoriteFoodIds.has(row.foodId) : false,
//                     variations: {},
//                     addons: {},
//                     category: row.categoryId ? {
//                         id: row.categoryId,
//                         name: row.categoryName,
//                         nameAr: row.categoryNameAr,
//                         nameFr: row.categoryNameFr,
//                     } : null,
//                     subcategory: row.subcategoryId ? {
//                         id: row.subcategoryId,
//                         name: row.subcategoryName,
//                         nameAr: row.subcategoryNameAr,
//                         nameFr: row.subcategoryNameFr,
//                         order_level: row.order_level,
//                     } : null,
//                 };
//             }
//             // 3. تجميع الـ Variations داخل الأكل
//             if (row.variationId) {
//                 if (!acc[catId].foods[row.foodId].variations[row.variationId]) {
//                     acc[catId].foods[row.foodId].variations[row.variationId] = {
//                         id: row.variationId,
//                         name: row.variationName,
//                         nameAr: row.variationNameAr,
//                         nameFr: row.variationNameFr,
//                         isRequired: row.isRequired,
//                         selectionType: row.selectionType,
//                         min: row.min,
//                         max: row.max,
//                         options: {}
//                     };
//                 }
//                 // 4. تجميع الـ Options داخل الـ Variations
//                 if (row.optionId) {
//                     if (!acc[catId].foods[row.foodId].variations[row.variationId].options[row.optionId]) {
//                         acc[catId].foods[row.foodId].variations[row.variationId].options[row.optionId] = {
//                             id: row.optionId,
//                             name: row.optionName,
//                             nameAr: row.optionNameAr,
//                             nameFr: row.optionNameFr,
//                             additionalPrice: row.additionalPrice
//                         };
//                     }
//                 }
//             }
//             // 5. تجميع الـ Addons داخل الأكل
//             if (row.addonId) {
//                 if (!acc[catId].foods[row.foodId].addons[row.addonId]) {
//                     acc[catId].foods[row.foodId].addons[row.addonId] = {
//                         id: row.addonId,
//                         name: row.addonName,
//                         nameAr: row.addonNameAr,
//                         nameFr: row.addonNameFr,
//                         price: row.addonPrice,
//                         status: row.addonStatus,
//                         stockType: row.addonStockType,
//                         restaurantId: row.addonRestaurantId,
//                         createdAt: row.addonCreatedAt,
//                         updatedAt: row.addonUpdatedAt,
//                         category: row.addonCategoryId ? {
//                             id: row.addonCategoryId,
//                             name: row.addonCategoryName,
//                             nameAr: row.addonCategoryNameAr,
//                             nameFr: row.addonCategoryNameFr,
//                         } : null
//                     };
//                 }
//             }
//         }
//         return acc;
//     }, {});
//     // 👇 تحويل الكاتيجوريز، الأكلات، الـ Variations، الـ Options، والـ Addons من Objects إلى Arrays
//     // ثم حساب الفروع غير المتاحة لكل وجبة
//     const allMenuFoods = Object.values(groupedMenuObj).flatMap((cat: any) => Object.values(cat.foods)) as any[];
//     // الوجبات التي status == active لكن isOutOfStock == false هي المرشحة للفحص
//     const menuActiveFoodIds = allMenuFoods
//         .filter((f: any) => !f.isOutOfStock)
//         .map((f: any) => f.id)
//         .filter(Boolean) as string[];
//     const menuUnavailableBranchesMap = menuActiveFoodIds.length > 0
//         ? await getUnavailableBranchesForFoods(menuActiveFoodIds)
//         : new Map<string, BranchInfo[]>();
//     // ─── جلب الفروع غير المتاحة بناءً على الـ subcategories ───
//     const activeSubcategoryIds = [...new Set(
//         allMenuFoods
//             .filter((f: any) => !f.isOutOfStock && f.subcategory?.id)
//             .map((f: any) => f.subcategory.id)
//     )] as string[];
//     const subcategoryUnavailableBranchesMap = new Map<string, BranchInfo[]>();
//     if (activeSubcategoryIds.length > 0) {
//         const inactiveSubcats = await db
//             .select({
//                 subcategoryId: branchSubcategories.subcategoryId,
//                 branchId: branches.id,
//                 branchName: branches.name,
//                 branchNameAr: branches.nameAr,
//                 branchNameFr: branches.nameFr,
//             })
//             .from(branchSubcategories)
//             .leftJoin(branches, eq(branchSubcategories.branchId, branches.id))
//             .where(and(
//                 inArray(branchSubcategories.subcategoryId, activeSubcategoryIds),
//                 eq(branchSubcategories.status, "inactive")
//             ));
//         for (const row of inactiveSubcats) {
//             if (!row.branchId) continue;
//             if (!subcategoryUnavailableBranchesMap.has(row.subcategoryId)) {
//                 subcategoryUnavailableBranchesMap.set(row.subcategoryId, []);
//             }
//             subcategoryUnavailableBranchesMap.get(row.subcategoryId)!.push({
//                 id: row.branchId,
//                 name: row.branchName || "",
//                 nameAr: row.branchNameAr,
//                 nameFr: row.branchNameFr,
//             });
//         }
//     }
//     const finalMenu = Object.values(groupedMenuObj).map((category: any) => {
//         return {
//             id: category.id,
//             name: category.name,
//             nameAr: category.nameAr,
//             nameFr: category.nameFr,
//             foods: Object.values(category.foods).map((f: any) => {
//                 // تحويل الـ variations والـ options
//                 f.variations = Object.values(f.variations).map((v: any) => {
//                     v.options = Object.values(v.options);
//                     return v;
//                 });
//                 // تحويل الـ Addons
//                 f.addons = Object.values(f.addons);
//                 // // إرفاق الفروع غير المتاحة
//                 // // null → الوجبة غير متاحة في جميع الفروع (isOutOfStock)
//                 // // [] أو [...] → قائمة الفروع غير المتاحة بالتحديد
//                 if (f.isOutOfStock) {
//                     f.unavailableBranches = null;
//                 } else {
//                     const foodUnavailableBranches = menuUnavailableBranchesMap.get(f.id) || [];
//                     const subcatUnavailableBranches = f.subcategory?.id
//                         ? (subcategoryUnavailableBranchesMap.get(f.subcategory.id) || [])
//                         : [];
//                     // دمج الفرعين بدون تكرار
//                     const combinedBranches = new Map<string, BranchInfo>();
//                     [...foodUnavailableBranches, ...subcatUnavailableBranches].forEach(b => {
//                         combinedBranches.set(b.id, b);
//                     });
//                     f.unavailableBranches = Array.from(combinedBranches.values());
//                 }
//                 //  if (f.isOutOfStock) {
//                 //     f.unavailableBranches = null;
//                 //     f.subcatUnavailableBranches = null;
//                 // } else {
//                 //     f.unavailableBranches = menuUnavailableBranchesMap.get(f.id) || [];
//                 //     f.subcatUnavailableBranches = f.subcategory?.id
//                 //         ? (subcategoryUnavailableBranchesMap.get(f.subcategory.id) || [])
//                 //         : [];
//                 // }
//                 return f;
//             })
//         };
//     });
//     // ==========================================
//     // جلب الـ Addons مع الـ Categories (للقائمة العامة)
//     // ==========================================
//     const rawAddons = await db.select({
//         addonId: addons.id,
//         addonName: addons.name,
//         addonNameAr: addons.nameAr,
//         addonNameFr: addons.nameFr,
//         addonPrice: addons.price,
//         addonStockType: addons.stock_type,
//         categoryId: adonescategory.id,
//         categoryName: adonescategory.name,
//         categoryNameAr: adonescategory.nameAr,
//         categoryNameFr: adonescategory.nameFr,
//     })
//         .from(addons)
//         .leftJoin(adonescategory, eq(addons.adonescategoryid, adonescategory.id))
//         .where(and(
//             eq(addons.restaurantid, restaurantId),
//             eq(addons.status, "active")
//         ));
//     const groupedAddonsObj = rawAddons.reduce((acc: any, row) => {
//         const catId = row.categoryId || "uncategorized";
//         if (!acc[catId]) {
//             acc[catId] = {
//                 id: catId === "uncategorized" ? null : catId,
//                 name: row.categoryName || "Other",
//                 nameAr: row.categoryNameAr || "أخرى",
//                 nameFr: row.categoryNameFr || "Autre",
//                 addons: []
//             };
//         }
//         if (row.addonId) {
//             acc[catId].addons.push({
//                 id: row.addonId,
//                 name: row.addonName,
//                 nameAr: row.addonNameAr,
//                 nameFr: row.addonNameFr,
//                 price: row.addonPrice,
//                 stockType: row.addonStockType
//             });
//         }
//         return acc;
//     }, {});
//     const finalAddons = Object.values(groupedAddonsObj).map((category: any) => {
//         return {
//             id: category.id,
//             name: category.name,
//             nameAr: category.nameAr,
//             nameFr: category.nameFr,
//             addons: category.addons
//         };
//     });
//     return SuccessResponse(res, {
//         data: {
//             restaurant: restaurantWithFav,
//             menu: finalMenu,
//             addons: finalAddons
//         }
//     });
// };
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
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const restaurantId = req.query.restaurantId;
    const conditions = [(0, drizzle_orm_1.eq)(schema_1.favorites.userId, userId)];
    if (restaurantId) {
        // Filter favorited foods belonging to the specific restaurant ID
        conditions.push((0, drizzle_orm_1.isNotNull)(schema_1.favorites.foodId));
        conditions.push((0, drizzle_orm_1.eq)(schema_1.food.restaurantid, restaurantId));
    }
    const favs = await connection_1.db.select({
        favoriteId: schema_1.favorites.id,
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
        food: {
            id: schema_1.food.id,
            restaurantId: schema_1.food.restaurantid, // Added restaurantId to food object
            name: schema_1.food.name,
            nameAr: schema_1.food.nameAr,
            nameFr: schema_1.food.nameFr,
            price: schema_1.food.price,
            image: schema_1.food.image,
            isOutOfStock: schema_1.food.isOutOfStock,
            discountType: schema_1.food.discount_type,
            discountValue: schema_1.food.discount_value,
        }
    })
        .from(schema_1.favorites)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.favorites.restaurantId, schema_1.restaurants.id))
        .leftJoin(schema_1.food, (0, drizzle_orm_1.eq)(schema_1.favorites.foodId, schema_1.food.id))
        .where((0, drizzle_orm_1.and)(...conditions));
    // Get unique restaurant IDs from both restaurant favorites and favorited foods
    const uniqueRestaurants = [
        ...new Set(favs
            .map(f => f.food?.restaurantId || f.restaurant?.id)
            .filter(Boolean))
    ];
    const discountsByRestaurant = new Map();
    for (const rId of uniqueRestaurants) {
        discountsByRestaurant.set(rId, await (0, discount_1.getAvailableDiscounts)(rId));
    }
    const result = {
        restaurants: favs.filter(f => f.restaurant?.id != null).map(f => f.restaurant),
        foods: favs.filter(f => f.food?.id != null).map(f => {
            const foodObj = f.food;
            const restId = foodObj.restaurantId || f.restaurant?.id || null;
            const availableDiscounts = restId ? discountsByRestaurant.get(restId) : [];
            const discountState = { remainingMaxDiscounts: new Map(), appliedDiscounts: new Set() };
            const { price: finalDiscountPrice, discountNote } = (0, discount_1.applyPriorityDiscount)({ id: foodObj.id, discountType: foodObj.discountType, discountValue: foodObj.discountValue }, Number(foodObj.price), 0, availableDiscounts || [], discountState, false);
            return {
                ...foodObj,
                discountPrice: finalDiscountPrice,
                discountNote,
                discountType: foodObj.discountType,
                discountValue: foodObj.discountValue
            };
        })
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
// 7. Search Restaurant With Menu (البحث الذكي الصارم عن المطعم والمنيو)
// ==========================================
const searchRestaurantWithMenu = async (req, res) => {
    const { query } = req.query;
    if (!query || typeof query !== "string") {
        throw new Errors_1.BadRequest("please enter your search term");
    }
    const cleanQuery = query.trim().toLowerCase();
    const normalizedQuery = cleanQuery.replace(/[-\s'&_]/g, "");
    const searchTerm = `%${cleanQuery}%`;
    const normalizedSearchTerm = `%${normalizedQuery}%`;
    const restaurantConditions = [
        (0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.restaurants.name} != ''`, (0, drizzle_orm_1.like)(schema_1.restaurants.name, searchTerm)),
        (0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.restaurants.nameAr} != ''`, (0, drizzle_orm_1.like)(schema_1.restaurants.nameAr, searchTerm)),
        (0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.restaurants.nameFr} != ''`, (0, drizzle_orm_1.like)(schema_1.restaurants.nameFr, searchTerm)),
        (0, drizzle_orm_1.sql) `REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${schema_1.restaurants.name}), '-', ''), ' ', ''), "'", ''), '&', '') = ${normalizedQuery}`,
        (0, drizzle_orm_1.sql) `REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${schema_1.restaurants.nameFr}), '-', ''), ' ', ''), "'", ''), '&', '') = ${normalizedQuery}`,
        (0, drizzle_orm_1.sql) `REPLACE(REPLACE(REPLACE(REPLACE(${schema_1.restaurants.nameAr}, '-', ''), ' ', ''), "'", ''), '&', '') = ${normalizedQuery}`,
        (0, drizzle_orm_1.sql) `REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${schema_1.restaurants.name}), '-', ''), ' ', ''), "'", ''), '&', '') LIKE ${normalizedSearchTerm}`
    ];
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
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurants.status, "active"), (0, drizzle_orm_1.or)(...restaurantConditions)));
    const restaurantsMap = new Map();
    for (const row of flatResults) {
        const r = row.restaurant;
        const f = row.food;
        const v = row.variation;
        const o = row.option;
        if (!r || !r.id)
            continue;
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
                    const exists = currentVariation.options.some((opt) => opt.id === o.id);
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
        discountsByRestaurant.set(rId, await (0, discount_1.getAvailableDiscounts)(rId));
    }
    // ==========================================
    // حساب الفروع غير المتاحة لكل وجبة في نتائج البحث
    // ==========================================
    const allSearchFoods = Array.from(restaurantsMap.values()).flatMap((r) => Array.from(r.food.values()));
    const searchActiveFoodIds = allSearchFoods
        .filter((f) => f.status === "active" && !f.isOutOfStock)
        .map((f) => f.id)
        .filter(Boolean);
    const searchUnavailableBranchesMap = searchActiveFoodIds.length > 0
        ? await (0, food_helper_1.getUnavailableBranchesForFoods)(searchActiveFoodIds)
        : new Map();
    const formattedData = Array.from(restaurantsMap.values()).map((restaurant) => {
        const availableDiscounts = discountsByRestaurant.get(restaurant.id) || [];
        return {
            ...restaurant,
            food: Array.from(restaurant.food.values()).map((foodItem) => {
                const discountState = { remainingMaxDiscounts: new Map(), appliedDiscounts: new Set() };
                const { price: finalDiscountPrice, discountNote } = (0, discount_1.applyPriorityDiscount)({ id: foodItem.id, discountType: foodItem.discount_type, discountValue: foodItem.discount_value }, Number(foodItem.price), 0, availableDiscounts, discountState, false);
                // إذا كانت الوجبة isOutOfStock أو غير active → غير متاحة في جميع الفروع
                const isGloballyUnavailable = foodItem.status !== "active" || foodItem.isOutOfStock;
                const unavailableBranches = isGloballyUnavailable
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
    return (0, response_1.SuccessResponse)(res, {
        message: "Fetched restaurant and menu data successfully",
        data: formattedData
    });
};
exports.searchRestaurantWithMenu = searchRestaurantWithMenu;
