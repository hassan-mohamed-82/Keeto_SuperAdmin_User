import { z } from "zod";

// ==========================================
// Restaurant Business Plans Validation
// ==========================================

export const createBusinessPlanSchema = z.object({
    // الحقول الأساسية والعلاقات (Required)
    restaurantId: z.string().uuid("Invalid Restaurant ID"),
    
    platformType: z.enum(["online_order", "food_aggregator", "mykeeto"], {
        required_error: "Platform type is required",
        invalid_type_error: "Platform type must be either 'online_order' or 'food_aggregator' or 'mykeeto'",
    }),

    // الاشتراكات الشهرية
    isMonthlyActive: z.boolean().optional(),
    monthlyAmount: z.coerce.string().optional(), // coerce.string عشان لو الفرونت بعتها رقم تتحول لـ string لضمان توافقها مع الـ Decimal

    // الاشتراكات الربع سنوية
    isQuarterlyActive: z.boolean().optional(),
    quarterlyAmount: z.coerce.string().optional(),

    // الاشتراكات السنوية
    isAnnuallyActive: z.boolean().optional(),
    annuallyAmount: z.coerce.string().optional(),

    // العمولات والرسوم
    commissionRate: z.coerce.string().optional(),
    serviceFee: z.coerce.string().optional(),
});

// فاليديشن التحديث (Update) - كل الحقول اختيارية
export const updateBusinessPlanSchema = createBusinessPlanSchema.partial();