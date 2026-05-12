"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCitySchema = exports.createCitySchema = void 0;
const zod_1 = require("zod");
exports.createCitySchema = zod_1.z.object({
    // الحقل الأساسي (Required)
    name: zod_1.z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    // العلاقات
    // في الـ Schema مفيش .notNull()، فعملتها optional، 
    // بس لو البيزنس لوجيك بتاعك بيجبر إن المدينة لازم تكون تابعة لدولة، شيل الـ .optional()
    countryId: zod_1.z.string().uuid("Invalid Country ID").optional(),
    // الحقول الاختيارية (ليها Default)
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
// فاليديشن التحديث (Update)
exports.updateCitySchema = exports.createCitySchema.partial();
