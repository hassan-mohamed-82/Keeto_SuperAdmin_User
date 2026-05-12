import { z } from "zod";

export const createSubcategorySchema = z.object({
    // العلاقة بالقسم الرئيسي (Required)
    categoryId: z.string().uuid("Invalid Category ID"),

    // الحقل الأساسي (Required)
    name: z.string().min(1, "Name is required").max(255),

    // الحقول الاختيارية والـ Defaults
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    
    priority: z.enum(["low", "medium", "high"]).optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateSubcategorySchema = createSubcategorySchema.partial();