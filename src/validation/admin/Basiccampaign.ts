import { z } from "zod";

// ==========================================
// Basic Campaign Validation
// ==========================================

// Regex للتحكم في صيغة الوقت (HH:MM أو HH:MM:SS)
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

export const createBasicCampaignSchema = z.object({
    // الحقول الأساسية (Required)
    Title: z.string().min(1, "Title is required").max(255, "Title cannot exceed 255 characters"),
    
    // التواريخ (استخدام coerce.date بيسمح بتحويل الـ String لـ Date Object أوتوماتيك)
    startDate: z.coerce.date({
        required_error: "Start date is required",
        invalid_type_error: "Invalid start date format",
    }),
    endDate: z.coerce.date({
        required_error: "End date is required",
        invalid_type_error: "Invalid end date format",
    }),

    // الأوقات (نتأكد إنها مبعوتة بصيغة وقت صحيحة)
    dailystarttime: z.string().regex(timeRegex, "Invalid time format. Use HH:MM or HH:MM:SS"),
    dailyendtime: z.string().regex(timeRegex, "Invalid time format. Use HH:MM or HH:MM:SS"),

    // الحقول الاختيارية (Nullable أو ليها Default)
    description: z.string().optional(),
    image: z.string().max(500, "Image URL/Path cannot exceed 500 characters").optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

// فاليديشن التحديث (Update) - كل الحقول اختيارية
export const updateBasicCampaignSchema = createBasicCampaignSchema.partial();