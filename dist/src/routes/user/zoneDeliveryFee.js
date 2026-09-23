"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const zoneDeliveryFee_1 = require("../../controllers/user/zoneDeliveryFee");
const validation_1 = require("../../middlewares/validation");
const zoneDeliveryFee_2 = require("../../validation/user/zoneDeliveryFee");
const router = (0, express_1.Router)();
// 🌐 Public: calculate zone and delivery fees for given coordinates
router.post("/", (0, validation_1.validate)(zoneDeliveryFee_2.getZoneDeliveryFeeSchema), (0, catchAsync_1.catchAsync)(zoneDeliveryFee_1.getZoneAndDeliveryFee));
exports.default = router;
