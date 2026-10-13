import { z } from "zod";

export const shippingLoginSchema = z.object({
    email: z.string().email("Invalid email format").min(1, "Email is required"),
    password: z.string().min(1, "Password is required"),
});

export const courierLoginSchema = z.object({
    phone: z.string().min(1, "Phone number is required"),
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

export const createCompanyUserSchema = z.object({
    name: z.string().min(1, "Name is required").max(255),
    email: z.string().email("Invalid email format"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    phone: z.string().max(50).optional(),
    role: z.enum(["admin", "dispatcher", "viewer"]).default("dispatcher"),
});

export const updateCompanyUserSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    phone: z.string().max(50).optional(),
    role: z.enum(["admin", "dispatcher", "viewer"]).optional(),
    status: z.enum(["active", "inactive"]).optional(),
});
