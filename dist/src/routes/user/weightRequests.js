"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const validation_1 = require("../../middlewares/validation");
const weightRequests_1 = require("../../controllers/user/weightRequests");
const weightRequests_2 = require("../../validation/user/weightRequests");
const router = (0, express_1.Router)();
// Send cart for weighing
router.post("/", (0, validation_1.validate)(weightRequests_2.sendWeightRequestSchema), (0, catchAsync_1.catchAsync)(weightRequests_1.sendWeightRequest));
// Get weight request details
router.get("/:id", (0, validation_1.validate)(weightRequests_2.getWeightRequestParamSchema, "params"), (0, catchAsync_1.catchAsync)(weightRequests_1.getWeightRequestById));
// Cancel weight request
router.post("/:id/cancel", (0, validation_1.validate)(weightRequests_2.getWeightRequestParamSchema, "params"), (0, validation_1.validate)(weightRequests_2.cancelWeightRequestSchema), (0, catchAsync_1.catchAsync)(weightRequests_1.cancelWeightRequest));
exports.default = router;
