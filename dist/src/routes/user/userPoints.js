"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const userPoints_1 = require("../../controllers/user/userPoints");
const router = (0, express_1.Router)();
router.get("/products/:restaurantId", (0, catchAsync_1.catchAsync)(userPoints_1.getRedeemableProducts));
router.post("/redeem/:restaurantId", (0, catchAsync_1.catchAsync)(userPoints_1.generateRedeemCode));
exports.default = router;
