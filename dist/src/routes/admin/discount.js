"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const discount_1 = require("../../controllers/admin/discount");
const validation_1 = require("../../middlewares/validation");
const discount_2 = require("../../validation/admin/discount");
const middlewares_1 = require("../../middlewares/");
const router = (0, express_1.Router)();
// Create discount
router.post("/", (0, validation_1.validate)(discount_2.createDiscountSchema), (0, middlewares_1.hasPermission)("Discounts", "Add"), (0, catchAsync_1.catchAsync)(discount_1.createDiscountByAdmin));
// Get all discounts
router.get("/", (0, middlewares_1.hasPermission)("Discounts", "View"), (0, catchAsync_1.catchAsync)(discount_1.getAllDiscountsByAdmin));
// Get discount by ID
router.get("/:id", (0, middlewares_1.hasPermission)("Discounts", "View"), (0, catchAsync_1.catchAsync)(discount_1.getDiscountByIdByAdmin));
// Update discount
router.put("/:id", (0, validation_1.validate)(discount_2.updateDiscountSchema), (0, middlewares_1.hasPermission)("Discounts", "Edit"), (0, catchAsync_1.catchAsync)(discount_1.updateDiscountByAdmin));
// Delete discount
router.delete("/:id", (0, middlewares_1.hasPermission)("Discounts", "Delete"), (0, catchAsync_1.catchAsync)(discount_1.deleteDiscountByAdmin));
// Toggle active status
router.patch("/:id/toggle-status", (0, middlewares_1.hasPermission)("Discounts", "Status"), (0, catchAsync_1.catchAsync)(discount_1.toggleDiscountStatusByAdmin));
exports.default = router;
