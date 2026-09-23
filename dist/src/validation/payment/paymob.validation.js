"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymobWebhookSchema = void 0;
const zod_1 = require("zod");
/**
 * Validation schema for Paymob Webhook transaction payload
 * Paymob POSTs a JSON object with `type: "TRANSACTION"` and `obj: { ... }`
 */
exports.paymobWebhookSchema = zod_1.z.object({
    type: zod_1.z.string().optional(),
    obj: zod_1.z.record(zod_1.z.any()).optional(),
    hmac: zod_1.z.string().optional(),
}).passthrough();
