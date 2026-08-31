"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const recommendedFood_1 = require("../../controllers/user/recommendedFood");
const router = (0, express_1.Router)();
// ✅ Get active recommended products for a basic food item
router.get("/:foodId", (0, catchAsync_1.catchAsync)(recommendedFood_1.getRecommendedFoodsForUser));
exports.default = router;
