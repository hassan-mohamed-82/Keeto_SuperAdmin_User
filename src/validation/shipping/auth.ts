import { z } from "zod";

export const shippingLoginSchema = z.object({
    email: z.string().email("Invalid email format").min(1, "Email is required"),
    password: z.string().min(1, "Password is required"),
});

export const shippingUpdateProfileSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    nameAr: z.string().max(255).optional(),
    phone: z.string().min(1).max(50).optional(),
    address: z.string().optional(),
    logo: z.string().max(500).optional(),
    password: z.string().min(6, "Password must be at least 6 characters").optional(),
});
