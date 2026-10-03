"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymobWebhookSchema = exports.paymobSessionSchema = void 0;
const zod_1 = require("zod");
/**
 * Validation schema for Paymob Payment Session endpoint
 * POST /api/payments/paymob/session
 */
exports.paymobSessionSchema = zod_1.z.object({
    orderId: zod_1.z.union([
        zod_1.z.string().min(1, "Order ID is required"),
        zod_1.z.number().positive().transform(String),
    ]),
    amount: zod_1.z.number().positive("Amount must be greater than 0").optional(),
    currency: zod_1.z.string().length(3, "Currency must be a 3-letter ISO 4217 code").default("EGP"),
    customerEmail: zod_1.z.string().email("Must be a valid email address").optional(),
});
/**
 * Validation schema for Paymob Webhook transaction payload
 * Paymob POSTs a JSON object with `type: "TRANSACTION"` and `obj: { ... }`
 */
exports.paymobWebhookSchema = zod_1.z.object({
    type: zod_1.z.string().optional(),
    obj: zod_1.z.record(zod_1.z.any()).optional(),
    hmac: zod_1.z.string().optional(),
}).passthrough();
