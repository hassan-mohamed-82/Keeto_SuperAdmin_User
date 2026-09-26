import { z } from "zod";

/**
 * Validation schema for Paymob Payment Session endpoint
 * POST /api/payments/paymob/session
 */
export const paymobSessionSchema = z.object({
    orderId: z.union([
        z.string().min(1, "Order ID is required"),
        z.number().positive().transform(String),
    ]),
    amount: z.number().positive("Amount must be greater than 0").optional(),
    currency: z.string().length(3, "Currency must be a 3-letter ISO 4217 code").default("EGP"),
    customerEmail: z.string().email("Must be a valid email address").optional(),
});

/**
 * Validation schema for Paymob Webhook transaction payload
 * Paymob POSTs a JSON object with `type: "TRANSACTION"` and `obj: { ... }`
 */
export const paymobWebhookSchema = z.object({
    type: z.string().optional(),
    obj: z.record(z.any()).optional(),
    hmac: z.string().optional(),
}).passthrough();

