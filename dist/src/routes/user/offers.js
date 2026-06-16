"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const offers_1 = require("../../controllers/user/offers");
const router = (0, express_1.Router)();
router.get("/", (0, catchAsync_1.catchAsync)(offers_1.getAllOffers));
router.get("/restaurant/:restaurantId/offers", (0, catchAsync_1.catchAsync)(offers_1.getRestaurantOffers));
exports.default = router;
