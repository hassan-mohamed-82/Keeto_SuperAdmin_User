import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cuisines, categories, restaurants, food, favorites } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors";

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

    // 1. بيانات المطعم
    const [restaurantInfo] = await db.select().from(restaurants)
        .where(eq(restaurants.id, restaurantId)).limit(1);

    if (!restaurantInfo) throw new Error("المطعم غير موجود");

    // 2. منيو المطعم (بنجيب الأكل ونعمله Join مع الفئات عشان نعرض اسم الفئة)
    const restaurantMenu = await db.select({
        foodId: food.id,
        foodName: food.name,
        description: food.description,
        price: food.price,
        image: food.image,
        foodType: food.foodtype,
        categoryId: categories.id,
        categoryName: categories.name
    }).from(food)
    .leftJoin(categories, eq(food.categoryid, categories.id))
    .where(and(
        eq(food.restaurantid, restaurantId),
        eq(food.status, "active")
    ));

    // 💡 تريكة للفرونت إند: نجمع الأكل جوه أقسامه عشان يظهر متصنف في الشاشة
    const groupedMenu = restaurantMenu.reduce((acc: any, item) => {
        const catName = item.categoryName || "أخرى";
        if (!acc[catName]) acc[catName] = [];
        acc[catName].push(item);
        return acc;
    }, {});

    return SuccessResponse(res, { 
        data: {
            restaurant: restaurantInfo,
            menu: groupedMenu // هيرجعلك JSON الأكل متقسم: { "Shawerma": [...], "Meals": [...] }
        } 
    });
};

// ==========================================
// 5. إضافة/إزالة المطعم من المفضلة (زرار القلب)
// ==========================================
export const toggleFavorite = async (req: Request, res: Response) => {
    // الفرونت هيبعت: نوع المفضلة، والأيدي بتاع اليوزر، والأيدي بتاع الحاجة اللي فضلها
    const userId = req.user?.id;
    const { restaurantId, foodId } = req.body;

    if (restaurantId && !foodId) throw new BadRequest("Restaurant ID is required");
    if (!restaurantId && foodId) throw new BadRequest("Food ID is required");

    // بناء الشرط بناءً على النوع
    const condition = restaurantId 
        ? and(eq(favorites.userId, userId), eq(favorites.restaurantId, restaurantId))
        : and(eq(favorites.userId, userId), eq(favorites.foodId, foodId));

    const existingFav = await db.select().from(favorites).where(condition).limit(1);

    if (existingFav[0]) {
        // لو موجودة نمسحها (Un-favorite)
        await db.delete(favorites).where(eq(favorites.id, existingFav[0].id));
        return SuccessResponse(res, { message: "تمت الإزالة من المفضلة", isFavorite: false });
    } else {
        // لو مش موجودة نضيفها (Favorite)
        await db.insert(favorites).values({ 
            userId, 
            restaurantId: restaurantId ? restaurantId : null,
            foodId: foodId ? foodId : null 
        });
        return SuccessResponse(res, { message: "تمت الإضافة للمفضلة", isFavorite: true });
    }
};

// ==========================================
// 6. جلب قائمة المفضلة ليوزر معين (Wishlist)
// ==========================================
export const getUserFavorites = async (req: Request, res: Response) => {
     const userId = req.user?.id; // بنجيب اليوزر آيدي من التوكن بعد ما نعمل Middleware للتحقق من التوكن
    const favorite = await db.select().from(favorites).where(eq(favorites.userId, userId));

    return SuccessResponse(res, { data: favorite });
};