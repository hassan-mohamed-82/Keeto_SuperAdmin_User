"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geideaWebhookSchema = exports.geideaSessionSchema = void 0;
const zod_1 = require("zod");
/**
 * Validation schema for Geidea Payment Session endpoint
 * POST /api/payments/geidea/session
 */
exports.geideaSessionSchema = zod_1.z.object({
    orderId: zod_1.z.union([
        zod_1.z.string().min(1, "Order ID is required"),
        zod_1.z.number().positive().transform(String),
    ]),
    amount: zod_1.z.number().positive("Amount must be greater than 0").optional(),
    currency: zod_1.z.string().length(3, "Currency must be a 3-letter ISO 4217 code").default("EGP"),
    customerEmail: zod_1.z.string().email("Must be a valid email address").optional(),
});
/**
 * Validation schema for Geidea Webhook transaction payload
 */
exports.geideaWebhookSchema = zod_1.z.object({
    orderId: zod_1.z.string().optional(),
    merchantReferenceId: zod_1.z.string().optional(),
    responseCode: zod_1.z.string().optional(),
    responseMessage: zod_1.z.string().optional(),
    detailedResponseCode: zod_1.z.string().optional(),
    detailedResponseMessage: zod_1.z.string().optional(),
    status: zod_1.z.string().optional(),
    signature: zod_1.z.string().optional(),
    amount: zod_1.z.number().or(zod_1.z.string()).optional(),
    currency: zod_1.z.string().optional(),
    order: zod_1.z.record(zod_1.z.any()).optional(),
    data: zod_1.z.record(zod_1.z.any()).optional(),
}).passthrough();
