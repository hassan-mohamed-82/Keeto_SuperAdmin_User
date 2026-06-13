import { z } from "zod";

// ==========================================
// Discounts Validation
// ==========================================

export const createDiscountSchema = z.object({
    // الحقول الأساسية (Required)
    name: z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    discountType: z.enum(["percentage", "fixed_amount"], {
        required_error: "Discount type is required (percentage | fixed_amount)"
    }),
    discountValue: z.union([z.number(), z.string()]).refine(val => {
        const num = typeof val === 'number' ? val : parseFloat(val);
        return !isNaN(num) && num >= 0;
    }, { message: "Discount value must be a non-negative number" }),

    // الحقول الاختيارية (عشان ليها default values في الداتا بيز)
    nameAr: z.string().max(255).optional().nullable(),
    nameFr: z.string().max(255).optional().nullable(),
    maxDiscount: z.union([z.number(), z.string()]).optional().nullable(),
    minOrderAmount: z.union([z.number(), z.string()]).optional().nullable(),
    usageLimit: z.number().int().optional().nullable(),
    startDate: z.coerce.date().optional().nullable(),
    endDate: z.coerce.date().optional().nullable(),
    isActive: z.boolean().optional(),
    restaurantIds: z.array(z.string().uuid("Invalid Restaurant ID")).optional(),
});

// فاليديشن التحديث (Update) - كل الحقول هتكون اختيارية
export const updateDiscountSchema = createDiscountSchema.partial();
