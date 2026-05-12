"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAdonesCategorySchema = exports.createAdonesCategorySchema = void 0;
const zod_1 = require("zod");
// ==========================================
// Adones Category Validation
// ==========================================
exports.createAdonesCategorySchema = zod_1.z.object({
    // الحقل الأساسي (Required)
    name: zod_1.z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    // الحقول الاختيارية (عشان ليها default values في الداتا بيز)
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
// فاليديشن التحديث (Update) - كل الحقول اختيارية
exports.updateAdonesCategorySchema = exports.createAdonesCategorySchema.partial();
