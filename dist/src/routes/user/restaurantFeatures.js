"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const restaurantFeatures_1 = require("../../controllers/user/restaurantFeatures");
const catchAsync_1 = require("../../utils/catchAsync");
const authenticated_1 = require("../../middlewares/authenticated");
const router = (0, express_1.Router)();
router.get("/search", authenticated_1.authenticated, (0, catchAsync_1.catchAsync)(restaurantFeatures_1.searchRestaurants));
router.get("/home-list", authenticated_1.authenticated, (0, catchAsync_1.catchAsync)(restaurantFeatures_1.getHomeRestaurants));
router.put("/:restaurantId/addhome", authenticated_1.authenticated, (0, catchAsync_1.catchAsync)(restaurantFeatures_1.toggleAddHome));
router.delete("/:restaurantId/addhome", authenticated_1.authenticated, (0, catchAsync_1.catchAsync)(restaurantFeatures_1.removeFromHome));
router.get("/:restaurantId/branches", authenticated_1.optionalAuth, (0, catchAsync_1.catchAsync)(restaurantFeatures_1.getRestaurantsBranches));
//check if the restaurant is open
router.get("/resturant-schedules/:restaurantId", authenticated_1.authenticated, (0, catchAsync_1.catchAsync)(restaurantFeatures_1.getResturantSchedules));
exports.default = router;
