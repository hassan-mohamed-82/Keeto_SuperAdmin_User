"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCouponSchema = exports.createCouponSchema = void 0;
const zod_1 = require("zod");
exports.createCouponSchema = zod_1.z.object({
    code: zod_1.z.string().trim().min(1, "Coupon code is required").max(50),
    name: zod_1.z.string().trim().min(1, "Coupon name is required").max(255),
    nameAr: zod_1.z.string().trim().max(255).optional().nullable(),
    nameFr: zod_1.z.string().trim().max(255).optional().nullable(),
    discountType: zod_1.z.enum(["percentage", "fixed_amount", "free_delivery"], {
        required_error: "Discount type is required (percentage | fixed_amount | free_delivery)",
    }),
    discountValue: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).refine((val) => {
        const num = typeof val === "number" ? val : parseFloat(val);
        return !isNaN(num) && num >= 0;
    }, "Discount value must be a valid number >= 0"),
    maxDiscount: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).optional().nullable(),
    minOrderAmount: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).optional().nullable(),
    usageLimit: zod_1.z.number().int().min(1).optional().nullable(),
    perUserLimit: zod_1.z.number().int().min(1).optional().nullable(),
    startDate: zod_1.z.string().optional().nullable(),
    endDate: zod_1.z.string().optional().nullable(),
    isActive: zod_1.z.boolean().optional(),
    restaurantIds: zod_1.z.array(zod_1.z.string().trim().min(1)).optional().nullable(),
    foodIds: zod_1.z.array(zod_1.z.string().trim().min(1)).optional().nullable(),
    foods: zod_1.z.array(zod_1.z.string().trim().min(1)).optional().nullable(),
});
exports.updateCouponSchema = zod_1.z.object({
    code: zod_1.z.string().trim().min(1).max(50).optional(),
    name: zod_1.z.string().trim().min(1).max(255).optional(),
    nameAr: zod_1.z.string().trim().max(255).optional().nullable(),
    nameFr: zod_1.z.string().trim().max(255).optional().nullable(),
    discountType: zod_1.z.enum(["percentage", "fixed_amount", "free_delivery"]).optional(),
    discountValue: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).optional().refine((val) => {
        if (val === undefined || val === null)
            return true;
        const num = typeof val === "number" ? val : parseFloat(val);
        return !isNaN(num) && num >= 0;
    }, "Discount value must be a valid number >= 0"),
    maxDiscount: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).optional().nullable(),
    minOrderAmount: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).optional().nullable(),
    usageLimit: zod_1.z.number().int().min(1).optional().nullable(),
    perUserLimit: zod_1.z.number().int().min(1).optional().nullable(),
    startDate: zod_1.z.string().optional().nullable(),
    endDate: zod_1.z.string().optional().nullable(),
    isActive: zod_1.z.boolean().optional(),
    restaurantIds: zod_1.z.array(zod_1.z.string().trim().min(1)).optional().nullable(),
    foodIds: zod_1.z.array(zod_1.z.string().trim().min(1)).optional().nullable(),
    foods: zod_1.z.array(zod_1.z.string().trim().min(1)).optional().nullable(),
});
