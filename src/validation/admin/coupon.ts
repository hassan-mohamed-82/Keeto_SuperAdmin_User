import { z } from "zod";

export const createCouponSchema = z.object({
    code: z.string().trim().min(1, "Coupon code is required").max(50),
    name: z.string().trim().min(1, "Coupon name is required").max(255),
    nameAr: z.string().trim().max(255).optional().nullable(),
    nameFr: z.string().trim().max(255).optional().nullable(),

    discountType: z.enum(["percentage", "fixed_amount", "free_delivery"], {
        required_error: "Discount type is required (percentage | fixed_amount | free_delivery)",
    }),

    discountValue: z.union([z.number(), z.string()]).refine((val) => {
        const num = typeof val === "number" ? val : parseFloat(val);
        return !isNaN(num) && num >= 0;
    }, "Discount value must be a valid number >= 0"),

    maxDiscount: z.union([z.number(), z.string()]).optional().nullable(),
    minOrderAmount: z.union([z.number(), z.string()]).optional().nullable(),

    usageLimit: z.number().int().min(1).optional().nullable(),
    perUserLimit: z.number().int().min(1).optional().nullable(),

    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
    isActive: z.boolean().optional(),

    restaurantIds: z.array(z.string().trim().min(1)).optional().nullable(),
    foodIds: z.array(z.string().trim().min(1)).optional().nullable(),
    foods: z.array(z.string().trim().min(1)).optional().nullable(),
});

export const updateCouponSchema = z.object({
    code: z.string().trim().min(1).max(50).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    nameAr: z.string().trim().max(255).optional().nullable(),
    nameFr: z.string().trim().max(255).optional().nullable(),

    discountType: z.enum(["percentage", "fixed_amount", "free_delivery"]).optional(),

    discountValue: z.union([z.number(), z.string()]).optional().refine((val) => {
        if (val === undefined || val === null) return true;
        const num = typeof val === "number" ? val : parseFloat(val);
        return !isNaN(num) && num >= 0;
    }, "Discount value must be a valid number >= 0"),

    maxDiscount: z.union([z.number(), z.string()]).optional().nullable(),
    minOrderAmount: z.union([z.number(), z.string()]).optional().nullable(),

    usageLimit: z.number().int().min(1).optional().nullable(),
    perUserLimit: z.number().int().min(1).optional().nullable(),

    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
    isActive: z.boolean().optional(),

    restaurantIds: z.array(z.string().trim().min(1)).optional().nullable(),
    foodIds: z.array(z.string().trim().min(1)).optional().nullable(),
    foods: z.array(z.string().trim().min(1)).optional().nullable(),
});
