"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
// استيراد الدوال من الكنترولر بتاع الـ  اللي عملناه
const home_1 = require("../../controllers/user/home");
// استيراد دوال المفضلة من الكنترولر بتاعها
const home_2 = require("../../controllers/user/home");
const catchAsync_1 = require("../../utils/catchAsync");
const authenticated_1 = require("../../middlewares/authenticated");
const router = (0, express_1.Router)();
// ==========================================
// 🏠 راوتس التصفح والشاشة الرئيسية (Explore & Home)
// ==========================================
router.get("/search", authenticated_1.optionalAuth, (0, catchAsync_1.catchAsync)(home_1.searchRestaurantWithMenu));
// 1. جلب الشاشة الرئيسية (المطابخ، الفئات، المطاعم)
// 🟢 GET: /api/user/explore/
router.get("/", authenticated_1.optionalAuth, (0, catchAsync_1.catchAsync)(home_1.getHomeScreen));
// 2. جلب المطاعم الخاصة بمطبخ معين (مثال: المطاعم التركية)
// 🟢 GET: /api/user/explore/cuisines/:cuisineId/restaurants
router.get("/cuisines/:cuisineId/restaurants", authenticated_1.optionalAuth, (0, catchAsync_1.catchAsync)(home_1.getRestaurantsByCuisine));
// 3. جلب الأكلات الخاصة بفئة معينة (مثال: الشاورما)
// 🟢 GET: /api/user/explore/categories/:categoryId/items
router.get("/categories/:categoryId/items", authenticated_1.optionalAuth, (0, catchAsync_1.catchAsync)(home_1.getFoodsByCategory));
// 4. جلب تفاصيل مطعم معين والمنيو بتاعه
// 🟢 GET: /api/user/explore/restaurants/:restaurantId
router.get("/restaurants/:restaurantId", authenticated_1.optionalAuth, (0, catchAsync_1.catchAsync)(home_1.getRestaurantDetails));
// ==========================================
// 🔍 راوتس البحث (Search)
// =========================================
// 5. البحث عن مطعم بالاسم مع جلب المنيو (اللي لسه عاملينها)
// 🟢 GET: /api/user/explore/search?query=kfc
// 6. جلب قائمة المفضلة الخاصة باليوزر
// 🟢 GET: /api/user/explore/favorites
router.get("/favorites", authenticated_1.authenticated, (0, catchAsync_1.catchAsync)(home_2.getUserFavorites));
// 7. إضافة أو إزالة مطعم/أكلة من المفضلة (بتاخد في الـ Body الـ restaurantId أو foodId)
// 🟡 POST: /api/user/explore/favorites/toggle
router.post("/favorites/toggle", authenticated_1.authenticated, (0, catchAsync_1.catchAsync)(home_2.toggleFavorite));
exports.default = router;
