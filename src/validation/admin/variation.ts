import { z } from "zod";

// ==========================================
// 1. Food Variations Validation
// ==========================================
export const createFoodVariationSchema = z.object({
    // العلاقة الأساسية (Required)
    foodId: z.string().uuid("Invalid Food ID"),

    // الحقل الأساسي (Required)
    name: z.string().min(1, "Variation name is required").max(255),

    // الحقول الاختيارية والـ Defaults
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    
    isRequired: z.boolean().optional(),
    selectionType: z.enum(["single", "multiple"]).optional(),
    
    // min و max أرقام صحيحة، وممكن اليوزر ميبعتهمش
    min: z.coerce.number().int().min(0, "Min cannot be negative").optional(),
    max: z.coerce.number().int().min(1, "Max must be at least 1").optional(),
    
    status: z.boolean().optional(),
});

export const updateFoodVariationSchema = createFoodVariationSchema.partial();

// ==========================================
// 2. Variation Options Validation
// ==========================================
export const createVariationOptionSchema = z.object({
    // العلاقة بالـ Variation (Required)
    variationId: z.string().uuid("Invalid Variation ID"),

    // الحقل الأساسي (Required)
    optionName: z.string().min(1, "Option name is required").max(255),

    // الحقول الاختيارية والـ Defaults
    optionNameAr: z.string().max(255).optional(),
    optionNameFr: z.string().max(255).optional(),
    
    // السعر الإضافي متسجل كـ varchar فبنتعامل معاه كـ string
    additionalPrice: z.string().max(255).optional(),
    
    status: z.boolean().optional(),
});

export const updateVariationOptionSchema = createVariationOptionSchema.partial();