"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const appDownloads_1 = require("../../controllers/admin/appDownloads");
const middlewares_1 = require("../../middlewares/");
const validation_1 = require("../../middlewares/validation");
const catchAsync_1 = require("../../utils/catchAsync");
const appDownloads_2 = require("../../validation/admin/appDownloads");
const router = (0, express_1.Router)();
// Pull fresh numbers from Google Play + App Store Connect (call it whenever you want)
router.post("/sync", (0, middlewares_1.hasPermission)("AppDownloads", "Edit"), (0, validation_1.validate)(appDownloads_2.syncAppDownloadsSchema), (0, catchAsync_1.catchAsync)(appDownloads_1.syncAppDownloadsHandler));
// Totals per restaurant
router.get("/", (0, middlewares_1.hasPermission)("AppDownloads", "View"), (0, validation_1.validate)(appDownloads_2.getAppDownloadsQuerySchema, "query"), (0, catchAsync_1.catchAsync)(appDownloads_1.getAppDownloads));
// One restaurant over time
router.get("/:restaurantId", (0, middlewares_1.hasPermission)("AppDownloads", "View"), (0, validation_1.validate)(appDownloads_2.restaurantAppDownloadsParamsSchema, "params"), (0, validation_1.validate)(appDownloads_2.restaurantAppDownloadsQuerySchema, "query"), (0, catchAsync_1.catchAsync)(appDownloads_1.getRestaurantAppDownloads));
exports.default = router;
