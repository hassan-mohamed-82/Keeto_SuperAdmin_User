import { z } from "zod";

export const createCitySchema = z.object({
    // الحقل الأساسي (Required)
    name: z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),

    // العلاقات
    // في الـ Schema مفيش .notNull()، فعملتها optional، 
    // بس لو البيزنس لوجيك بتاعك بيجبر إن المدينة لازم تكون تابعة لدولة، شيل الـ .optional()
    countryId: z.string().uuid("Invalid Country ID").optional(),

    // الحقول الاختيارية (ليها Default)
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

// فاليديشن التحديث (Update)
export const updateCitySchema = createCitySchema.partial();