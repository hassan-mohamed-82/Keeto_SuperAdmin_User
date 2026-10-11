"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const shippingCompany_1 = require("../../controllers/admin/shippingCompany");
const catchAsync_1 = require("../../utils/catchAsync");
const validation_1 = require("../../middlewares/validation");
const shippingCompany_2 = require("../../validation/admin/shippingCompany");
const router = (0, express_1.Router)();
// جلب المطاعم المؤهلة للربط بشركة الشحن (homeDelivery = true & selfDelivery = false)
router.get("/eligible-restaurants", (0, catchAsync_1.catchAsync)(shippingCompany_1.getEligibleRestaurants));
// إدارة شركات الشحن
router.post("/", (0, validation_1.validate)(shippingCompany_2.createShippingCompanySchema), (0, catchAsync_1.catchAsync)(shippingCompany_1.createShippingCompany));
router.get("/", (0, catchAsync_1.catchAsync)(shippingCompany_1.getShippingCompanies));
router.get("/:id", (0, catchAsync_1.catchAsync)(shippingCompany_1.getShippingCompanyById));
router.put("/:id", (0, validation_1.validate)(shippingCompany_2.updateShippingCompanySchema), (0, catchAsync_1.catchAsync)(shippingCompany_1.updateShippingCompany));
router.delete("/:id", (0, catchAsync_1.catchAsync)(shippingCompany_1.deleteShippingCompany));
// إسناد مطاعم لشركة الشحن وفك إسنادها
router.post("/:id/assign-restaurants", (0, validation_1.validate)(shippingCompany_2.assignRestaurantsSchema), (0, catchAsync_1.catchAsync)(shippingCompany_1.assignRestaurantsToCompany));
router.delete("/:id/restaurants/:restaurantId", (0, catchAsync_1.catchAsync)(shippingCompany_1.removeRestaurantFromCompany));
exports.default = router;
