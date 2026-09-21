import { z } from "zod";

export interface CreatePaymentSessionDTO {
    orderId: string;
    amount: number;       // Number representing amount (e.g., 250.00)
    currency?: string;    // Defaults to "EGP"
    customerEmail?: string;
}

/**
 * Validation schema for Kashier Payment Session endpoint
 * POST /api/v1/payments/kashier/session
 *
 * Backend calls Kashier POST /v3/payment/sessions and returns { sessionId, sessionUrl, expireAt }.
 * Frontend redirects (web) or opens WebView (mobile) to sessionUrl.
 */
export const sessionSchema = z.object({
    orderId: z.union([
        z.string().min(1, "Order ID is required"),
        z.number().positive().transform(String),
    ]),
    amount: z.number().positive("Amount must be greater than 0").optional(),
    currency: z.string().length(3, "Currency must be a 3-letter ISO 4217 code").default("EGP"),
    customerEmail: z.string().email("Must be a valid email address").optional(),
});

/**
 * Validation schema for Kashier Webhook payload
 */
export const webhookSchema = z.object({
    event: z.string().optional(),
    data: z.record(z.any()).optional(),
    signature: z.string().optional(),
}).passthrough();
