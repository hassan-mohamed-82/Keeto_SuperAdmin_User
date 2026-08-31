"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/user/coupon.ts
const express_1 = require("express");
const coupon_1 = require("../../controllers/user/coupon");
const catchAsync_1 = require("../../utils/catchAsync");
const router = (0, express_1.Router)();
router.post("/check", (0, catchAsync_1.catchAsync)(coupon_1.checkCoupon));
router.get("/available", (0, catchAsync_1.catchAsync)(coupon_1.getAvailableCoupons));
exports.default = router;
