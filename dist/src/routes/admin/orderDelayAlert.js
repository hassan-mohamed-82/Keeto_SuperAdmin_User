"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const validation_1 = require("../../middlewares/validation");
const orderDelayAlert_1 = require("../../controllers/admin/orderDelayAlert");
const orderDelayAlert_2 = require("../../validation/admin/orderDelayAlert");
const router = (0, express_1.Router)();
// 1. Create alert group
router.post("/", (0, validation_1.validate)(orderDelayAlert_2.createOrderDelayAlertGroupSchema), (0, catchAsync_1.catchAsync)(orderDelayAlert_1.createAlertGroup));
// 2. Lookup restaurants (for multi-select dropdown)
router.get("/lookup-restaurants", (0, catchAsync_1.catchAsync)(orderDelayAlert_1.getRestaurantsLookup));
// 3. Get all alert groups
router.get("/", (0, catchAsync_1.catchAsync)(orderDelayAlert_1.getAllAlertGroups));
// 4. Get alert group by ID
router.get("/:id", (0, catchAsync_1.catchAsync)(orderDelayAlert_1.getAlertGroupById));
// 5. Update alert group
router.put("/:id", (0, validation_1.validate)(orderDelayAlert_2.updateOrderDelayAlertGroupSchema), (0, catchAsync_1.catchAsync)(orderDelayAlert_1.updateAlertGroup));
// 6. Toggle active status (supports both PATCH /:id/toggle and PUT /:id/toggle-status)
router.put("/:id/toggle-status", (0, catchAsync_1.catchAsync)(orderDelayAlert_1.toggleAlertGroupStatus));
// 7. Delete alert group
router.delete("/:id", (0, catchAsync_1.catchAsync)(orderDelayAlert_1.deleteAlertGroup));
exports.default = router;
