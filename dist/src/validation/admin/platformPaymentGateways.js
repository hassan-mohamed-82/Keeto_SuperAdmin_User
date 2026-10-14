"use strict";
// src/validation/admin/platformPaymentGateways.ts
// Zod validation schemas for the Platform Payment Gateways CRUD endpoints.
Object.defineProperty(exports, "__esModule", { value: true });
exports.activatePlatformGatewaySchema = exports.updatePlatformGatewaySchema = exports.createPlatformGatewaySchema = void 0;
const zod_1 = require("zod");
// ─────────────────────────────────────────────────────────
// Per-provider credential schemas (loose — sensitive fields
// are optional so the update endpoint can send partial data)
// ─────────────────────────────────────────────────────────
const kashierCredentialsSchema = zod_1.z.object({
    mid: zod_1.z.string().min(1, "Kashier Merchant ID (MID) is required"),
    apiKey: zod_1.z.string().min(1, "Kashier API Key is required"),
    secretKey: zod_1.z.string().optional().or(zod_1.z.literal("")),
    baseUrl: zod_1.z.string().url("Must be a valid URL").optional().or(zod_1.z.literal("")),
});
const paymobCredentialsSchema = zod_1.z.object({
    secretKey: zod_1.z.string().min(1, "Paymob Secret Key is required"),
    publicKey: zod_1.z.string().min(1, "Paymob Public Key is required"),
    integrationId: zod_1.z.string().min(1, "Paymob Integration ID is required"),
    hmac: zod_1.z.string().min(1, "Paymob HMAC secret is required"),
    callbackUrl: zod_1.z.string().url("Must be a valid URL").optional().or(zod_1.z.literal("")),
    apiKey: zod_1.z.string().optional().or(zod_1.z.literal("")),
    iframeId: zod_1.z.string().optional().or(zod_1.z.literal("")),
});
const geideaCredentialsSchema = zod_1.z.object({
    publicKey: zod_1.z.string().min(1, "Geidea Public Key is required"),
    apiPassword: zod_1.z.string().min(1, "Geidea API Password is required"),
    name: zod_1.z.string().optional(),
    environment: zod_1.z.string().optional(),
    callbackUrl: zod_1.z.string().url("Must be a valid URL").optional().or(zod_1.z.literal("")),
    returnUrl: zod_1.z.string().url("Must be a valid URL").optional().or(zod_1.z.literal("")),
});
const credentialsSchema = zod_1.z.union([
    kashierCredentialsSchema,
    paymobCredentialsSchema,
    geideaCredentialsSchema,
    zod_1.z.record(zod_1.z.any()),
]);
// ─────────────────────────────────────────────────────────
// Exported schemas
// ─────────────────────────────────────────────────────────
exports.createPlatformGatewaySchema = zod_1.z.object({
    title: zod_1.z.string().min(1, "Title is required"),
    provider: zod_1.z.enum(["PAYMOB", "KASHIER", "GEIDEA"]),
    environment: zod_1.z.enum(["LIVE", "TEST"]).default("LIVE"),
    credentials: credentialsSchema,
    logoUrl: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    isActive: zod_1.z.boolean().optional().default(false),
});
exports.updatePlatformGatewaySchema = zod_1.z.object({
    title: zod_1.z.string().min(1).optional(),
    provider: zod_1.z.enum(["PAYMOB", "KASHIER", "GEIDEA"]).optional(),
    environment: zod_1.z.enum(["LIVE", "TEST"]).optional(),
    credentials: zod_1.z.record(zod_1.z.any()).optional(),
    logoUrl: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    isActive: zod_1.z.boolean().optional(),
});
exports.activatePlatformGatewaySchema = zod_1.z.object({
// No body needed — the gateway to activate is identified by the URL param
});
