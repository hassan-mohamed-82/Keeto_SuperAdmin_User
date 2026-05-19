import { z } from "zod";

// ==========================================
// Categories Validation
// ==========================================

export const createCategorySchema = z.object({
    // الحقول الأساسية (Required)
    name: z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    // Image: z.string().min(1, "Image is required").max(500, "Image URL/Path cannot exceed 500 characters"),

    // الحقول الاختيارية (ليها Default أو Nullable)
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    
    // meta_image: z.string().max(500).optional(),
    
    title: z.string().optional(),
    titleAr: z.string().optional(),
    titleFr: z.string().optional(),
    
    meta_title: z.string().optional(),
    meta_titleAr: z.string().optional(),
    meta_titleFr: z.string().optional(),
    
    priority: z.enum(["low", "medium", "high"]).optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

// فاليديشن التحديث (Update) - كل الحقول اختيارية
export const updateCategorySchema = createCategorySchema.partial();