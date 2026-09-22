"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const bundles_1 = require("../../controllers/user/bundles");
const validation_1 = require("../../middlewares/validation");
const authenticated_1 = require("../../middlewares/authenticated");
const bundles_2 = require("../../validation/user/bundles");
const router = (0, express_1.Router)();
// ─── Bundle Offers Retrieval ──────────────────────────────────────────────────
// 1. List active bundle offers (GET /offers/bundles)
router.get("", authenticated_1.optionalAuth, (0, validation_1.validate)(bundles_2.getAllBundlesQuerySchema, "query"), (0, catchAsync_1.catchAsync)(bundles_1.getAllBundles));
// 2. Get single bundle offer details (GET /offers/bundles/:offerId)
router.get("/:id", authenticated_1.optionalAuth, (0, validation_1.validate)(bundles_2.getBundleByIdParamsSchema, "params"), (0, catchAsync_1.catchAsync)(bundles_1.getBundleById));
exports.default = router;
