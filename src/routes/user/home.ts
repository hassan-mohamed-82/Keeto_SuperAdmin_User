import { Router } from "express";

// استيراد الدوال من الكنترولر بتاع الـ  اللي عملناه
import { 
    getHomeScreen, 
    getRestaurantsByCuisine, 
    getFoodsByCategory, 
    searchRestaurantWithMenu,
    getRestaurantDetails 
} from "../../controllers/user/home";

// استيراد دوال المفضلة من الكنترولر بتاعها
import { 
    toggleFavorite, 
    getUserFavorites 
} from "../../controllers/user/home";

import { catchAsync } from "../../utils/catchAsync";
import { optionalAuth, authenticated } from "../../middlewares/authenticated";

const router = Router();

// ==========================================
// 🏠 راوتس التصفح والشاشة الرئيسية (Explore & Home)
// ==========================================

router.get("/search", optionalAuth, catchAsync(searchRestaurantWithMenu));

// 1. جلب الشاشة الرئيسية (المطابخ، الفئات، المطاعم)
// 🟢 GET: /api/user/explore/
router.get("/", optionalAuth, catchAsync(getHomeScreen));

// 2. جلب المطاعم الخاصة بمطبخ معين (مثال: المطاعم التركية)
// 🟢 GET: /api/user/explore/cuisines/:cuisineId/restaurants
router.get("/cuisines/:cuisineId/restaurants", optionalAuth, catchAsync(getRestaurantsByCuisine));

// 3. جلب الأكلات الخاصة بفئة معينة (مثال: الشاورما)
// 🟢 GET: /api/user/explore/categories/:categoryId/items
router.get("/categories/:categoryId/items", optionalAuth, catchAsync(getFoodsByCategory));

// 4. جلب تفاصيل مطعم معين والمنيو بتاعه
// 🟢 GET: /api/user/explore/restaurants/:restaurantId
router.get("/restaurants/:restaurantId", optionalAuth, catchAsync(getRestaurantDetails));

// ==========================================
// 🔍 راوتس البحث (Search)
// =========================================

// 5. البحث عن مطعم بالاسم مع جلب المنيو (اللي لسه عاملينها)
// 🟢 GET: /api/user/explore/search?query=kfc


// 6. جلب قائمة المفضلة الخاصة باليوزر
// 🟢 GET: /api/user/explore/favorites
router.get("/favorites", authenticated, catchAsync(getUserFavorites));

// 7. إضافة أو إزالة مطعم/أكلة من المفضلة (بتاخد في الـ Body الـ restaurantId أو foodId)
// 🟡 POST: /api/user/explore/favorites/toggle
router.post("/favorites/toggle", authenticated, catchAsync(toggleFavorite));


export default router;