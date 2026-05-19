"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCategorySchema = exports.createCategorySchema = void 0;
const zod_1 = require("zod");
// ==========================================
// Categories Validation
// ==========================================
exports.createCategorySchema = zod_1.z.object({
    // الحقول الأساسية (Required)
    name: zod_1.z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    // Image: z.string().min(1, "Image is required").max(500, "Image URL/Path cannot exceed 500 characters"),
    // الحقول الاختيارية (ليها Default أو Nullable)
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    // meta_image: z.string().max(500).optional(),
    title: zod_1.z.string().optional(),
    titleAr: zod_1.z.string().optional(),
    titleFr: zod_1.z.string().optional(),
    meta_title: zod_1.z.string().optional(),
    meta_titleAr: zod_1.z.string().optional(),
    meta_titleFr: zod_1.z.string().optional(),
    priority: zod_1.z.enum(["low", "medium", "high"]).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
// فاليديشن التحديث (Update) - كل الحقول اختيارية
exports.updateCategorySchema = exports.createCategorySchema.partial();
