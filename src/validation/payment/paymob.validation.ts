import { z } from "zod";

/**
 * Validation schema for Paymob Webhook transaction payload
 * Paymob POSTs a JSON object with `type: "TRANSACTION"` and `obj: { ... }`
 */
export const paymobWebhookSchema = z.object({
    type: z.string().optional(),
    obj: z.record(z.any()).optional(),
    hmac: z.string().optional(),
}).passthrough();
