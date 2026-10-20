// src/validation/admin/platformPaymentGateways.ts
// Zod validation schemas for the Platform Payment Gateways CRUD endpoints.

import { z } from "zod";

// ─────────────────────────────────────────────────────────
// Per-provider credential schemas (loose — sensitive fields
// are optional so the update endpoint can send partial data)
// ─────────────────────────────────────────────────────────

const kashierCredentialsSchema = z.object({
    mid: z.string().min(1, "Kashier Merchant ID (MID) is required"),
    apiKey: z.string().min(1, "Kashier API Key is required"),
    secretKey: z.string().optional().or(z.literal("")),
    baseUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

const paymobCredentialsSchema = z.object({
    secretKey: z.string().min(1, "Paymob Secret Key is required"),
    publicKey: z.string().min(1, "Paymob Public Key is required"),
    integrationId: z.string().min(1, "Paymob Integration ID is required"),
    hmac: z.string().min(1, "Paymob HMAC secret is required"),
    callbackUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
    apiKey: z.string().optional().or(z.literal("")),
    iframeId: z.string().optional().or(z.literal("")),
});

const geideaCredentialsSchema = z.object({
    publicKey: z.string().min(1, "Geidea Public Key is required"),
    apiPassword: z.string().min(1, "Geidea API Password is required"),
    name: z.string().optional(),
    environment: z.string().optional(),
    callbackUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
    returnUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

const credentialsSchema = z.union([
    kashierCredentialsSchema,
    paymobCredentialsSchema,
    geideaCredentialsSchema,
    z.record(z.any()),
]);

// ─────────────────────────────────────────────────────────
// Exported schemas
// ─────────────────────────────────────────────────────────

export const createPlatformGatewaySchema = z.object({
    title: z.string().min(1, "Title is required"),
    provider: z.enum(["PAYMOB", "KASHIER", "GEIDEA"]),
    environment: z.enum(["LIVE", "TEST"]).default("LIVE"),
    credentials: credentialsSchema,
    logoUrl: z.string().url().optional().or(z.literal("")),
    isActive: z.boolean().optional().default(false),
    isDefault: z.boolean().optional(),
});

export const updatePlatformGatewaySchema = z.object({
    title: z.string().min(1).optional(),
    provider: z.enum(["PAYMOB", "KASHIER", "GEIDEA"]).optional(),
    environment: z.enum(["LIVE", "TEST"]).optional(),
    credentials: z.record(z.any()).optional(),
    logoUrl: z.string().url().optional().or(z.literal("")),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
});

export const setDefaultPlatformGatewaySchema = z.object({
    // No body needed — the gateway to set as default is identified by URL param
});

export const activatePlatformGatewaySchema = z.object({
    // No body needed — the gateway to activate is identified by the URL param
});
