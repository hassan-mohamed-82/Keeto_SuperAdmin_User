import { z } from "zod";

// ==========================================
// Adones Category Validation
// ==========================================

export const createAdonesCategorySchema = z.object({
    // الحقل الأساسي (Required)
    name: z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),

    // الحقول الاختيارية (عشان ليها default values في الداتا بيز)
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

// فاليديشن التحديث (Update) - كل الحقول اختيارية
export const updateAdonesCategorySchema = createAdonesCategorySchema.partial();
