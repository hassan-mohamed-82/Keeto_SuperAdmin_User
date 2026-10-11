"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shippingUpdateProfileSchema = exports.shippingLoginSchema = void 0;
const zod_1 = require("zod");
exports.shippingLoginSchema = zod_1.z.object({
    email: zod_1.z.string().email("Invalid email format").min(1, "Email is required"),
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
