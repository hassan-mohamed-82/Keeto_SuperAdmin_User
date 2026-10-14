"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCompanyUserSchema = exports.createCompanyUserSchema = exports.shippingUpdateProfileSchema = exports.courierLoginSchema = exports.shippingLoginSchema = void 0;
const zod_1 = require("zod");
exports.shippingLoginSchema = zod_1.z.object({
    email: zod_1.z.string().email("Invalid email format").min(1, "Email is required"),
    password: zod_1.z.string().min(1, "Password is required"),
});
exports.courierLoginSchema = zod_1.z.object({
    phone: zod_1.z.string().min(1, "Phone number is required"),
    password: zod_1.z.string().min(1, "Password is required"),
});
exports.shippingUpdateProfileSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(255).optional(),
    nameAr: zod_1.z.string().max(255).optional(),
    phone: zod_1.z.string().min(1).max(50).optional(),
    address: zod_1.z.string().optional(),
    logo: zod_1.z.string().max(500).optional(),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters").optional(),
});
exports.createCompanyUserSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Name is required").max(255),
    email: zod_1.z.string().email("Invalid email format"),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters"),
    phone: zod_1.z.string().max(50).optional(),
    role: zod_1.z.enum(["admin", "dispatcher", "viewer"]).default("dispatcher"),
});
exports.updateCompanyUserSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(255).optional(),
    email: zod_1.z.string().email().optional(),
    password: zod_1.z.string().min(6).optional(),
    phone: zod_1.z.string().max(50).optional(),
    role: zod_1.z.enum(["admin", "dispatcher", "viewer"]).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
