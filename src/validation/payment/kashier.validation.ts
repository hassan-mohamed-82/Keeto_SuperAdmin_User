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
 * Validation schema for Kashier HMAC Hash generation endpoint
 */
export const generateHashSchema = z.object({
    orderId: z.union([z.string().min(1, "Order ID is required"), z.number().int().positive()]),
    amount: z.union([
        z.number().positive("Amount must be greater than 0"),
        z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be a valid positive number"),
    ]),
    currency: z.string().min(3).max(3).default("EGP"),
});

/**
 * Validation schema for Kashier Direct Card Charge endpoint
 */
export const directChargeSchema = z.object({
    orderId: z.union([z.string().min(1, "Order ID is required"), z.number().int().positive()]),
    amount: z.union([
        z.number().positive("Amount must be greater than 0"),
        z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be a valid positive number"),
    ]),
    currency: z.string().min(3).max(3).default("EGP"),
    cardNumber: z
        .string()
        .transform((val) => val.replace(/\s+/g, ""))
        .refine((val) => /^\d{13,19}$/.test(val), {
            message: "Card number must contain between 13 and 19 digits",
        }),
    expiryMonth: z
        .string()
        .regex(/^(0[1-9]|1[0-2])$/, "Expiry month must be between 01 and 12"),
    expiryYear: z
        .string()
        .regex(/^(\d{2}|\d{4})$/, "Expiry year must be 2 or 4 digits")
        .transform((val) => (val.length === 2 ? `20${val}` : val)),
    cvv: z
        .string()
        .regex(/^\d{3,4}$/, "CVV must be 3 or 4 digits"),
    cardHolderName: z
        .string()
        .min(2, "Cardholder name must be at least 2 characters")
        .max(100, "Cardholder name is too long"),
    saveCard: z.boolean().optional().default(false),
});

/**
 * Validation schema for Kashier Webhook payload
 */
export const webhookSchema = z.object({
    event: z.string().optional(),
    data: z.record(z.any()).optional(),
    signature: z.string().optional(),
}).passthrough();
