// src/routes/admin/platformPaymentGateways.ts
// Routes for Super Admin management of platform-level payment gateways.
// Follows project convention: route file → controller → validate middleware.

import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { hasPermission } from "../../middlewares";
import {
    listPlatformGateways,
    getPlatformGateway,
    createPlatformGateway,
    updatePlatformGateway,
    deletePlatformGateway,
    activatePlatformGateway,
    getActivePlatformGateway,
} from "../../controllers/admin/platformPaymentGateways";
import {
    createPlatformGatewaySchema,
    updatePlatformGatewaySchema,
} from "../../validation/admin/platformPaymentGateways";

const router = Router();

// GET /admin/platform-gateways/active  — must come before /:id to avoid "active" being parsed as an ID
router.get(
    "/active",
    hasPermission("PlatformPaymentGateways", "View"),
    catchAsync(getActivePlatformGateway)
);

// GET /admin/platform-gateways
router.get(
    "/",
    hasPermission("PlatformPaymentGateways", "View"),
    catchAsync(listPlatformGateways)
);

// GET /admin/platform-gateways/:id
router.get(
    "/:id",
    hasPermission("PlatformPaymentGateways", "View"),
    catchAsync(getPlatformGateway)
);

// POST /admin/platform-gateways
router.post(
    "/",
    hasPermission("PlatformPaymentGateways", "Add"),
    validate(createPlatformGatewaySchema),
    catchAsync(createPlatformGateway)
);

// PUT /admin/platform-gateways/:id
router.put(
    "/:id",
    hasPermission("PlatformPaymentGateways", "Edit"),
    validate(updatePlatformGatewaySchema),
    catchAsync(updatePlatformGateway)
);

// DELETE /admin/platform-gateways/:id
router.delete(
    "/:id",
    hasPermission("PlatformPaymentGateways", "Delete"),
    catchAsync(deletePlatformGateway)
);

// PUT /admin/platform-gateways/:id/activate
router.put(
    "/:id/activate",
    hasPermission("PlatformPaymentGateways", "Edit"),
    catchAsync(activatePlatformGateway)
);

export default router;
