import { z } from "zod";

export const createCuisineSchema = z.object({
    // الحقول الأساسية (Required)
    name: z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    Image: z.string().min(1, "Image is required").max(500, "Image URL/Path cannot exceed 500 characters"),

    // الحقول الاختيارية (Nullable أو ليها Default)
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    
    meta_image: z.string().max(500).optional(),
    
    description: z.string().optional(),
    descriptionAr: z.string().optional(),
    descriptionFr: z.string().optional(),
    
    meta_description: z.string().optional(),
    meta_descriptionAr: z.string().optional(),
    meta_descriptionFr: z.string().optional(),
    
    status: z.enum(["active", "inactive"]).optional(),
    
    // total_restaurants في الـ Schema نوعه varchar(255)
    total_restaurants: z.string().max(255).optional(), 
});

// فاليديشن التحديث (Update)
export const updateCuisineSchema = createCuisineSchema.partial();