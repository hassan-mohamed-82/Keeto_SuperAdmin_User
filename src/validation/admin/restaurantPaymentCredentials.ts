import { z } from "zod";

const paymobCredentialsSchema = z.object({
    apiKey: z.string().min(1, "Paymob API Key is required"),
    integrationId: z.string().min(1, "Integration ID is required"),
    iframeId: z.string().min(1, "iFrame ID is required"),
    hmac: z.string().min(1, "HMAC secret is required"),
    callbackUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

export const createPaymentCredentialsSchema = z.object({
    provider: z.enum(["PAYMOB"]),
    environment: z.enum(["LIVE", "TEST"]).default("LIVE"),
    credentials: paymobCredentialsSchema,
    logoUrl: z.string().url().optional().or(z.literal("")),
    isActive: z.boolean().optional().default(true),
});

export const updatePaymentCredentialsSchema = z.object({
    provider: z.enum(["PAYMOB"]).optional(),
    environment: z.enum(["LIVE", "TEST"]).optional(),
    credentials: paymobCredentialsSchema.partial().optional(),
    logoUrl: z.string().url().optional().or(z.literal("")),
    isActive: z.boolean().optional(),
});

export const toggleCredentialSchema = z.object({
    isActive: z.boolean(),
});
