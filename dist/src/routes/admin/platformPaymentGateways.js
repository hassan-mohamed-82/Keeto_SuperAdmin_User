"use strict";
// src/routes/admin/platformPaymentGateways.ts
// Routes for Super Admin management of platform-level payment gateways.
// Follows project convention: route file → controller → validate middleware.
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const validation_1 = require("../../middlewares/validation");
const middlewares_1 = require("../../middlewares");
const platformPaymentGateways_1 = require("../../controllers/admin/platformPaymentGateways");
const platformPaymentGateways_2 = require("../../validation/admin/platformPaymentGateways");
const router = (0, express_1.Router)();
// GET /admin/platform-gateways/active  — must come before /:id to avoid "active" being parsed as an ID
router.get("/active", (0, middlewares_1.hasPermission)("PlatformPaymentGateways", "View"), (0, catchAsync_1.catchAsync)(platformPaymentGateways_1.getActivePlatformGateway));
// GET /admin/platform-gateways
router.get("/", (0, middlewares_1.hasPermission)("PlatformPaymentGateways", "View"), (0, catchAsync_1.catchAsync)(platformPaymentGateways_1.listPlatformGateways));
// GET /admin/platform-gateways/:id
router.get("/:id", (0, middlewares_1.hasPermission)("PlatformPaymentGateways", "View"), (0, catchAsync_1.catchAsync)(platformPaymentGateways_1.getPlatformGateway));
// POST /admin/platform-gateways
router.post("/", (0, middlewares_1.hasPermission)("PlatformPaymentGateways", "Add"), (0, validation_1.validate)(platformPaymentGateways_2.createPlatformGatewaySchema), (0, catchAsync_1.catchAsync)(platformPaymentGateways_1.createPlatformGateway));
// PUT /admin/platform-gateways/:id
router.put("/:id", (0, middlewares_1.hasPermission)("PlatformPaymentGateways", "Edit"), (0, validation_1.validate)(platformPaymentGateways_2.updatePlatformGatewaySchema), (0, catchAsync_1.catchAsync)(platformPaymentGateways_1.updatePlatformGateway));
// DELETE /admin/platform-gateways/:id
router.delete("/:id", (0, middlewares_1.hasPermission)("PlatformPaymentGateways", "Delete"), (0, catchAsync_1.catchAsync)(platformPaymentGateways_1.deletePlatformGateway));
// PUT /admin/platform-gateways/:id/activate
router.put("/:id/activate", (0, middlewares_1.hasPermission)("PlatformPaymentGateways", "Edit"), (0, catchAsync_1.catchAsync)(platformPaymentGateways_1.activatePlatformGateway));
exports.default = router;
