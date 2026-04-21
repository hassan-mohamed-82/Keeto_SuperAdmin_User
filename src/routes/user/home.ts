import { Router } from "express";

// استيراد الدوال من الكنترولر بتاع الـ Explore اللي عملناه
import { 
    getHomeScreen, 
    getRestaurantsByCuisine, 
    getFoodsByCategory, 
    getRestaurantDetails 
} from "../../controllers/user/home";

// استيراد دوال المفضلة من الكنترولر بتاعها
import { 
    toggleFavorite, 
    getUserFavorites 
} from "../../controllers/user/home";

const router = Router();

// ==========================================
// 🏠 راوتس التصفح والشاشة الرئيسية (Explore & Home)
// ==========================================

// 1. جلب الشاشة الرئيسية (المطابخ، الفئات، المطاعم)
// 🟢 GET: /api/user/explore/home
router.get("/", getHomeScreen);

// 2. جلب المطاعم الخاصة بمطبخ معين (مثال: المطاعم التركية)
// 🟢 GET: /api/user/explore/cuisines/:cuisineId/restaurants
router.get("/cuisines/:cuisineId/restaurants", getRestaurantsByCuisine);

// 3. جلب الأكلات الخاصة بفئة معينة (مثال: الشاورما)
// 🟢 GET: /api/user/explore/categories/:categoryId/items
router.get("/categories/:categoryId/items", getFoodsByCategory);

// 4. جلب تفاصيل مطعم معين والمنيو بتاعه
// 🟢 GET: /api/user/explore/restaurants/:restaurantId
router.get("/restaurants/:restaurantId", getRestaurantDetails);




export default router;