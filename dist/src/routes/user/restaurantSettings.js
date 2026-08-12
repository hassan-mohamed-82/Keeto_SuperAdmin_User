"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const restaurantSettings_1 = require("../../controllers/user/restaurantSettings");
const catchAsync_1 = require("../../utils/catchAsync");
const router = (0, express_1.Router)();
router.get("/:restaurantId", (0, catchAsync_1.catchAsync)(restaurantSettings_1.getRestaurantSettings));
exports.default = router;
