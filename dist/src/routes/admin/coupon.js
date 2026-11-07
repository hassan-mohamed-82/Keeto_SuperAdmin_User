"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const coupon_1 = require("../../controllers/admin/coupon");
const validation_1 = require("../../middlewares/validation");
const coupon_2 = require("../../validation/admin/coupon");
const router = (0, express_1.Router)();
// CRUD
router.post("/", (0, validation_1.validate)(coupon_2.createCouponSchema), (0, catchAsync_1.catchAsync)(coupon_1.createCoupon));
router.get("/", (0, catchAsync_1.catchAsync)(coupon_1.getAllCoupons));
router.get("/:id", (0, catchAsync_1.catchAsync)(coupon_1.getCouponById));
router.put("/:id", (0, validation_1.validate)(coupon_2.updateCouponSchema), (0, catchAsync_1.catchAsync)(coupon_1.updateCoupon));
router.delete("/:id", (0, catchAsync_1.catchAsync)(coupon_1.deleteCoupon));
// Toggle active/inactive
router.patch("/:id/toggle-status", (0, catchAsync_1.catchAsync)(coupon_1.toggleCouponStatus));
// Usage history for a specific coupon
router.get("/:id/usages", (0, catchAsync_1.catchAsync)(coupon_1.getCouponUsages));
exports.default = router;
