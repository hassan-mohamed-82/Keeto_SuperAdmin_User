"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookSchema = exports.sessionSchema = void 0;
const zod_1 = require("zod");
/**
 * Validation schema for Kashier Payment Session endpoint
 * POST /api/v1/payments/kashier/session
 *
 * Backend calls Kashier POST /v3/payment/sessions and returns { sessionId, sessionUrl, expireAt }.
 * Frontend redirects (web) or opens WebView (mobile) to sessionUrl.
 */
exports.sessionSchema = zod_1.z.object({
    orderId: zod_1.z.union([
        zod_1.z.string().min(1, "Order ID is required"),
        zod_1.z.number().positive().transform(String),
    ]),
    amount: zod_1.z.number().positive("Amount must be greater than 0").optional(),
    currency: zod_1.z.string().length(3, "Currency must be a 3-letter ISO 4217 code").default("EGP"),
    customerEmail: zod_1.z.string().email("Must be a valid email address").optional(),
});
/**
 * Validation schema for Kashier Webhook payload
 */
exports.webhookSchema = zod_1.z.object({
    event: zod_1.z.string().optional(),
    data: zod_1.z.record(zod_1.z.any()).optional(),
    signature: zod_1.z.string().optional(),
}).passthrough();
