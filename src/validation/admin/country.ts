import { z } from "zod";

// ==========================================
// 1. Countries Validation
// ==========================================

export const createCountrySchema = z.object({
    // الحقل الأساسي (Required)
    name: z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),

    // الحقول الاختيارية (ليها Default)
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

// فاليديشن التحديث (Update)
export const updateCountrySchema = createCountrySchema.partial();