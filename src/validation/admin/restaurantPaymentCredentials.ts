import { z } from "zod";

const paymobCredentialsSchema = z.object({
    apiKey: z.string().min(1, "Paymob API Key is required"),
    integrationId: z.string().min(1, "Integration ID is required"),
    iframeId: z.string().min(1, "iFrame ID is required"),
    hmac: z.string().min(1, "HMAC secret is required"),
    callbackUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

const kashierCredentialsSchema = z.object({
    mid: z.string().min(1, "Kashier Merchant ID (MID) is required"),
    apiKey: z.string().min(1, "Kashier API Key is required"),
    secretKey: z.string().optional().or(z.literal("")),
    baseUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

const geideaCredentialsSchema = z.object({
    publicKey: z.string().min(1, "Geidea Public Key is required"),
    apiPassword: z.string().min(1, "Geidea API Password is required"),
    name: z.string().optional(),
    environment: z.string().optional(),
    callbackUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
    returnUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

const credentialsSchema = z.union([
    paymobCredentialsSchema,
    kashierCredentialsSchema,
    geideaCredentialsSchema,
    z.record(z.any()),
]);

export const createPaymentCredentialsSchema = z.object({
    provider: z.enum(["PAYMOB", "KASHIER", "GEIDEA"]),
    title: z.string().optional(),
    environment: z.enum(["LIVE", "TEST"]).default("LIVE"),
    credentials: credentialsSchema,
    logoUrl: z.string().url().optional().or(z.literal("")),
    isActive: z.boolean().optional().default(true),
});

export const updatePaymentCredentialsSchema = z.object({
    provider: z.enum(["PAYMOB", "KASHIER", "GEIDEA"]).optional(),
    title: z.string().optional(),
    environment: z.enum(["LIVE", "TEST"]).optional(),
    credentials: z.record(z.any()).optional(),
    logoUrl: z.string().url().optional().or(z.literal("")),
    isActive: z.boolean().optional(),
});

export const toggleCredentialSchema = z.object({
    isActive: z.boolean(),
});
