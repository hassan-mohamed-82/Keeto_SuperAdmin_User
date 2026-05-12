"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCountrySchema = exports.createCountrySchema = void 0;
const zod_1 = require("zod");
// ==========================================
// 1. Countries Validation
// ==========================================
exports.createCountrySchema = zod_1.z.object({
    // الحقل الأساسي (Required)
    name: zod_1.z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    // الحقول الاختيارية (ليها Default)
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
// فاليديشن التحديث (Update)
exports.updateCountrySchema = exports.createCountrySchema.partial();
