import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cuisines, categories, restaurants, food, favorites, foodVariations, variationOptions } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound, UnauthorizedError } from "../../Errors";

// ==========================================
// 1. API شاشة الهوم (Home Screen)
// بيجيب المطابخ، الفئات، والمطاعم في Request واحد عشان السرعة
// ==========================================
export const getHomeScreen = async (req: Request, res: Response) => {
    // 1. جلب المطابخ النشطة
    const activeCuisines = await db.select({
        id: cuisines.id,
        name: cuisines.name,
        image: cuisines.Image
    }).from(cuisines).where(eq(cuisines.status, "active"));

    // 2. جلب الفئات النشطة
    const activeCategories = await db.select({
        id: categories.id,
        name: categories.name,
        image: categories.Image
    }).from(categories).where(eq(categories.status, "active"));

    // 3. جلب المطاعم (ممكن تحدد limit أو تعتمد على zoneId لليوزر)
    const popularRestaurants = await db.select({
        id: restaurants.id,
        name: restaurants.name,
        cover: restaurants.cover,
        logo: restaurants.logo,
        address: restaurants.address,
        minDeliveryTime: restaurants.minDeliveryTime,
    }).from(restaurants).where(eq(restaurants.status, "active"));

    return SuccessResponse(res, {
        data: {
            cuisines: activeCuisines,
            categories: activeCategories,
            restaurants: popularRestaurants
        }
    });
};

// ==========================================
// 2. الفلترة بالمطبخ (لما يدوس على Turkish مثلاً)
// ==========================================
export const getRestaurantsByCuisine = async (req: Request, res: Response) => {
    const { cuisineId } = req.params;

    const cuisineRestaurants = await db.select({
        id: restaurants.id,
        name: restaurants.name,
        cover: restaurants.cover,
        logo: restaurants.logo,
        address: restaurants.address,
        minDeliveryTime: restaurants.minDeliveryTime,
    }).from(restaurants)
    .where(and(
        eq(restaurants.cuisineId, cuisineId), 
        eq(restaurants.status, "active")
    ));

    return SuccessResponse(res, { data: cuisineRestaurants });
};

// ==========================================
// 3. الفلترة بالفئة (لما يدوس على Shawerma مثلاً)
// بيجيب الأكلات من الفئة دي ومعاها بيانات المطعم اللي بيقدمها
// ==========================================
export const getFoodsByCategory = async (req: Request, res: Response) => {
    const { categoryId } = req.params;

    const categoryFoods = await db.select({
        foodId: food.id,
        foodName: food.name,
        foodImage: food.image,
        price: food.price,
        restaurantId: restaurants.id,
        restaurantName: restaurants.name,
        restaurantLogo: restaurants.logo
    }).from(food)
    .leftJoin(restaurants, eq(food.restaurantid, restaurants.id))
    .where(and(
        eq(food.categoryid, categoryId),
        eq(food.status, "active")
    ));

    return SuccessResponse(res, { data: categoryFoods });
};

// ==========================================
// 4. صفحة المطعم والمنيو (لما يدوس على مطعم معين)
// ==========================================
export const getRestaurantDetails = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    // 1. جلب بيانات المطعم
    const [restaurantInfo] = await db.select().from(restaurants)
        .where(eq(restaurants.id, restaurantId)).limit(1);

    if (!restaurantInfo) throw new Error("المطعم غير موجود");

    // 2. جلب المنيو بالكامل مع الفئات (Categories) والإضافات (Variations & Options)
    const rawMenu = await db.select({
        // بيانات الأكلة
        foodId: food.id,
        foodName: food.name,
        description: food.description,
        price: food.price,
        image: food.image,
        // بيانات الفئة
        categoryName: categories.name,
        // بيانات الفارييشن (مثال: الحجم)
        variationId: foodVariations.id,
        variationName: foodVariations.name,
        isRequired: foodVariations.isRequired,
        selectionType: foodVariations.selectionType,
        min: foodVariations.min,
        max: foodVariations.max,
        // بيانات الخيارات (مثال: صغير، وسط، كبير)
        optionId: variationOptions.id,
        optionName: variationOptions.optionName,
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

    // 3. 💡 التريكة الاحترافية: تجميع البيانات (Grouping) لتكوين شجرة JSON متكاملة للفرونت إند
    const groupedMenuObj = rawMenu.reduce((acc: any, row) => {
        const catName = row.categoryName || "أخرى";
        
        // لو الكاتيجوري مش موجود، نكريته
        if (!acc[catName]) acc[catName] = {};

        // لو الأكلة مش موجودة جوه الكاتيجوري، نكريتها ونجهز مصفوفة للفارييشنز
        if (!acc[catName][row.foodId]) {
            acc[catName][row.foodId] = {
                id: row.foodId,
                name: row.foodName,
                description: row.description,
                price: row.price,
                image: row.image,
                variations: {} // هنستخدم Object مؤقتاً عشان نمنع التكرار
            };
        }

        // لو الأكلة ليها فارييشن (Variations)
        if (row.variationId) {
            if (!acc[catName][row.foodId].variations[row.variationId]) {
                acc[catName][row.foodId].variations[row.variationId] = {
                    id: row.variationId,
                    name: row.variationName,
                    isRequired: row.isRequired,
                    selectionType: row.selectionType,
                    min: row.min,
                    max: row.max,
                    options: [] // مصفوفة الخيارات
                };
            }

            // لو الفارييشن ليه خيارات (Options)
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

    // 4. تحويل الـ Objects الداخلية لـ Arrays عشان الفرونت إند يعرف يعمل عليها .map()
    const finalMenu: any = {};
    for (const [category, foodsObj] of Object.entries(groupedMenuObj)) {
        finalMenu[category] = Object.values(foodsObj as object).map((foodItem: any) => {
            // تحويل الفارييشنز من Object لـ Array
            foodItem.variations = Object.values(foodItem.variations);
            return foodItem;
        });
    }

    return SuccessResponse(res, { 
        data: {
            restaurant: restaurantInfo,
            menu: finalMenu 
        } 
    });
};
// ==========================================
// 5. إضافة/إزالة المطعم من المفضلة (زرار القلب)
// ==========================================
export const toggleFavorite = async (req: Request, res: Response) => {
    try {
        if (!req.user) throw new UnauthorizedError("Unauthenticated");
        const userId = req.user.id; 
        const { restaurantId, foodId } = req.body;

        if (!restaurantId && !foodId) {
            throw new BadRequest("Restaurant ID or Food ID is required");
        }

        if (restaurantId && foodId) {
            throw new BadRequest("Send only one of restaurantId or foodId");
        }

        // بناء الشرط بناءً على النوع
        const condition = restaurantId 
            ? and(eq(favorites.userId, userId), eq(favorites.restaurantId, restaurantId))
            : and(eq(favorites.userId, userId), eq(favorites.foodId, foodId));

        // الخطأ بيحصل في السطر ده 👇
        const existingFav = await db.select().from(favorites).where(condition).limit(1);

        if (existingFav[0]) {
            await db.delete(favorites).where(eq(favorites.id, existingFav[0].id));
            return SuccessResponse(res, { message: "تمت الإزالة من المفضلة", isFavorite: false });
        } else {
            await db.insert(favorites).values({ 
                userId, 
                restaurantId: restaurantId ? restaurantId : null,
                foodId: foodId ? foodId : null 
            });
            return SuccessResponse(res, { message: "تمت الإضافة للمفضلة", isFavorite: true });
        }
    } catch (error) {
        // السطر ده هيقولنا مين العمود أو الجدول اللي مش موجود
        console.error("🔥🔥 MYSQL SELECT ERROR: ", error);
        throw error;
    }
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
            cover: restaurants.cover,
            logo: restaurants.logo,
            address: restaurants.address,
            
        },
        // بيانات الأكلة (ستكون null لو كان السجل يخص مطعم)
        food: {
            id: food.id,
            name: food.name,
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



