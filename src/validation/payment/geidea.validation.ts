import { z } from "zod";

/**
 * Validation schema for Geidea Payment Session endpoint
 * POST /api/payments/geidea/session
 */
export const geideaSessionSchema = z.object({
    orderId: z.union([
        z.string().min(1, "Order ID is required"),
        z.number().positive().transform(String),
    ]),
    amount: z.number().positive("Amount must be greater than 0").optional(),
    currency: z.string().length(3, "Currency must be a 3-letter ISO 4217 code").default("EGP"),
    customerEmail: z.string().email("Must be a valid email address").optional(),
});

/**
 * Validation schema for Geidea Webhook transaction payload
 */
export const geideaWebhookSchema = z.object({
    orderId: z.string().optional(),
    merchantReferenceId: z.string().optional(),
    responseCode: z.string().optional(),
    responseMessage: z.string().optional(),
    detailedResponseCode: z.string().optional(),
    detailedResponseMessage: z.string().optional(),
    status: z.string().optional(),
    signature: z.string().optional(),
    amount: z.number().or(z.string()).optional(),
    currency: z.string().optional(),
    order: z.record(z.any()).optional(),
    data: z.record(z.any()).optional(),
}).passthrough();
