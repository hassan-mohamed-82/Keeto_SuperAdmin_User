"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSubcategorySchema = exports.createSubcategorySchema = void 0;
const zod_1 = require("zod");
exports.createSubcategorySchema = zod_1.z.object({
    // العلاقة بالقسم الرئيسي (Required)
    categoryId: zod_1.z.string().uuid("Invalid Category ID"),
    // الحقل الأساسي (Required)
    name: zod_1.z.string().min(1, "Name is required").max(255),
    // الحقول الاختيارية والـ Defaults
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    priority: zod_1.z.enum(["low", "medium", "high"]).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateSubcategorySchema = exports.createSubcategorySchema.partial();
