"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const restaurantGroups_1 = require("../../controllers/user/restaurantGroups");
const authenticated_1 = require("../../middlewares/authenticated");
const router = (0, express_1.Router)();
// ==========================================
// User Restaurant Groups Endpoints
// ==========================================
// 1. Get restaurant group(s) by user coordinates (lat, lng)
// router.get("/by-location", optionalAuth, catchAsync(getRestaurantGroupsByLocation));
router.post("/by-location", authenticated_1.optionalAuth, (0, catchAsync_1.catchAsync)(restaurantGroups_1.getRestaurantGroupsByLocation));
// 2. Get single restaurant group details & restaurants list
router.get("/:id", authenticated_1.optionalAuth, (0, catchAsync_1.catchAsync)(restaurantGroups_1.getUserRestaurantGroupById));
exports.default = router;
