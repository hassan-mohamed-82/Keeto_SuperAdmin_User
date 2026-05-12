import { z } from "zod";

export const createZoneSchema = z.object({
    // الحقول الأساسية (Required)
    name: z.string().min(1, "Name is required").max(255),
    displayName: z.string().min(1, "Display name is required").max(255),
    
    // الإحداثيات الجغرافية متسجلة كـ varchar
    lat: z.string().min(1, "Latitude is required").max(255),
    lng: z.string().min(1, "Longitude is required").max(255),

    // العلاقات (في الـ Schema مفيش notNull فبتبقى Optional)
    cityId: z.string().uuid("Invalid City ID").optional(),

    // الحقول الاختيارية والـ Defaults
    nameAr: z.string().max(255).optional(),
    nameFr: z.string().max(255).optional(),
    displayNameAr: z.string().max(255).optional(),
    displayNameFr: z.string().max(255).optional(),
    
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateZoneSchema = createZoneSchema.partial();