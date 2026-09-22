"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const offers_1 = require("../../controllers/user/offers");
const validation_1 = require("../../middlewares/validation");
const authenticated_1 = require("../../middlewares/authenticated");
const offers_2 = require("../../validation/user/offers");
const router = (0, express_1.Router)();
// 1. GET /offers — Flat list of active food offers
router.get("/", authenticated_1.optionalAuth, (0, catchAsync_1.catchAsync)(offers_1.getAllOffers));
// 2. GET /offers/restaurant/:restaurantId/offers — Restaurant flat food offers
router.get("/restaurant/:restaurantId/offers", (0, catchAsync_1.catchAsync)(offers_1.getRestaurantOffers));
// 3. GET /offers/restaurant/:restaurantId/discounts — Restaurant discounts with products
router.get("/restaurant/:restaurantId/discounts", authenticated_1.optionalAuth, (0, validation_1.validate)(offers_2.getRestaurantDiscountsParamsSchema, "params"), (0, catchAsync_1.catchAsync)(offers_1.getAllDiscountsWithProducts));
exports.default = router;
