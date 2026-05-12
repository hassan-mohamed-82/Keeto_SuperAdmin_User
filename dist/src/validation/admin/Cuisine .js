"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCuisineSchema = exports.createCuisineSchema = void 0;
const zod_1 = require("zod");
exports.createCuisineSchema = zod_1.z.object({
    // الحقول الأساسية (Required)
    name: zod_1.z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    Image: zod_1.z.string().min(1, "Image is required").max(500, "Image URL/Path cannot exceed 500 characters"),
    // الحقول الاختيارية (Nullable أو ليها Default)
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    meta_image: zod_1.z.string().max(500).optional(),
    description: zod_1.z.string().optional(),
    descriptionAr: zod_1.z.string().optional(),
    descriptionFr: zod_1.z.string().optional(),
    meta_description: zod_1.z.string().optional(),
    meta_descriptionAr: zod_1.z.string().optional(),
    meta_descriptionFr: zod_1.z.string().optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
    // total_restaurants في الـ Schema نوعه varchar(255)
    total_restaurants: zod_1.z.string().max(255).optional(),
});
// فاليديشن التحديث (Update)
exports.updateCuisineSchema = exports.createCuisineSchema.partial();
