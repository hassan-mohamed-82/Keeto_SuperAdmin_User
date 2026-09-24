"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toggleCredentialSchema = exports.updatePaymentCredentialsSchema = exports.createPaymentCredentialsSchema = void 0;
const zod_1 = require("zod");
const paymobCredentialsSchema = zod_1.z.object({
    apiKey: zod_1.z.string().min(1, "Paymob API Key is required"),
    integrationId: zod_1.z.string().min(1, "Integration ID is required"),
    iframeId: zod_1.z.string().min(1, "iFrame ID is required"),
    hmac: zod_1.z.string().min(1, "HMAC secret is required"),
    callbackUrl: zod_1.z.string().url("Must be a valid URL").optional().or(zod_1.z.literal("")),
});
const kashierCredentialsSchema = zod_1.z.object({
    mid: zod_1.z.string().min(1, "Kashier Merchant ID (MID) is required"),
    apiKey: zod_1.z.string().min(1, "Kashier API Key is required"),
    secretKey: zod_1.z.string().optional().or(zod_1.z.literal("")),
    baseUrl: zod_1.z.string().url("Must be a valid URL").optional().or(zod_1.z.literal("")),
});
const credentialsSchema = zod_1.z.union([
    paymobCredentialsSchema,
    kashierCredentialsSchema,
    zod_1.z.record(zod_1.z.any()),
]);
exports.createPaymentCredentialsSchema = zod_1.z.object({
    provider: zod_1.z.enum(["PAYMOB", "KASHIER"]),
    title: zod_1.z.string().optional(),
    environment: zod_1.z.enum(["LIVE", "TEST"]).default("LIVE"),
    credentials: credentialsSchema,
    logoUrl: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    isActive: zod_1.z.boolean().optional().default(true),
});
exports.updatePaymentCredentialsSchema = zod_1.z.object({
    provider: zod_1.z.enum(["PAYMOB", "KASHIER"]).optional(),
    title: zod_1.z.string().optional(),
    environment: zod_1.z.enum(["LIVE", "TEST"]).optional(),
    credentials: zod_1.z.record(zod_1.z.any()).optional(),
    logoUrl: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    isActive: zod_1.z.boolean().optional(),
});
exports.toggleCredentialSchema = zod_1.z.object({
    isActive: zod_1.z.boolean(),
});
