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
exports.createPaymentCredentialsSchema = zod_1.z.object({
    provider: zod_1.z.enum(["PAYMOB"]),
    environment: zod_1.z.enum(["LIVE", "TEST"]).default("LIVE"),
    credentials: paymobCredentialsSchema,
    logoUrl: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    isActive: zod_1.z.boolean().optional().default(true),
});
exports.updatePaymentCredentialsSchema = zod_1.z.object({
    provider: zod_1.z.enum(["PAYMOB"]).optional(),
    environment: zod_1.z.enum(["LIVE", "TEST"]).optional(),
    credentials: paymobCredentialsSchema.partial().optional(),
    logoUrl: zod_1.z.string().url().optional().or(zod_1.z.literal("")),
    isActive: zod_1.z.boolean().optional(),
});
exports.toggleCredentialSchema = zod_1.z.object({
    isActive: zod_1.z.boolean(),
});
