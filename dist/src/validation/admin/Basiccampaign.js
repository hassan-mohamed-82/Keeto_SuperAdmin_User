"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBasicCampaignSchema = exports.createBasicCampaignSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// Basic Campaign Validation
// ==========================================
// Regex للتحكم في صيغة الوقت (HH:MM أو HH:MM:SS)
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;
exports.createBasicCampaignSchema = zod_1.z.object({
    // الحقول الأساسية (Required)
    Title: zod_1.z.string().min(1, "Title is required").max(255, "Title cannot exceed 255 characters"),
    // التواريخ (استخدام coerce.date بيسمح بتحويل الـ String لـ Date Object أوتوماتيك)
    startDate: zod_1.z.coerce.date({
        required_error: "Start date is required",
        invalid_type_error: "Invalid start date format",
    }),
    endDate: zod_1.z.coerce.date({
        required_error: "End date is required",
        invalid_type_error: "Invalid end date format",
    }),
    // الأوقات (نتأكد إنها مبعوتة بصيغة وقت صحيحة)
    dailystarttime: zod_1.z.string().regex(timeRegex, "Invalid time format. Use HH:MM or HH:MM:SS"),
    dailyendtime: zod_1.z.string().regex(timeRegex, "Invalid time format. Use HH:MM or HH:MM:SS"),
    // الحقول الاختيارية (Nullable أو ليها Default)
    description: zod_1.z.string().optional(),
    image: zod_1.z.string().max(500, "Image URL/Path cannot exceed 500 characters").optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
// فاليديشن التحديث (Update) - كل الحقول اختيارية
exports.updateBasicCampaignSchema = exports.createBasicCampaignSchema.partial();
