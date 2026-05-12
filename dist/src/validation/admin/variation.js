"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateVariationOptionSchema = exports.createVariationOptionSchema = exports.updateFoodVariationSchema = exports.createFoodVariationSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// 1. Food Variations Validation
// ==========================================
exports.createFoodVariationSchema = zod_1.z.object({
    // العلاقة الأساسية (Required)
    foodId: zod_1.z.string().uuid("Invalid Food ID"),
    // الحقل الأساسي (Required)
    name: zod_1.z.string().min(1, "Variation name is required").max(255),
    // الحقول الاختيارية والـ Defaults
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    isRequired: zod_1.z.boolean().optional(),
    selectionType: zod_1.z.enum(["single", "multiple"]).optional(),
    // min و max أرقام صحيحة، وممكن اليوزر ميبعتهمش
    min: zod_1.z.coerce.number().int().min(0, "Min cannot be negative").optional(),
    max: zod_1.z.coerce.number().int().min(1, "Max must be at least 1").optional(),
    status: zod_1.z.boolean().optional(),
});
exports.updateFoodVariationSchema = exports.createFoodVariationSchema.partial();
// ==========================================
// 2. Variation Options Validation
// ==========================================
exports.createVariationOptionSchema = zod_1.z.object({
    // العلاقة بالـ Variation (Required)
    variationId: zod_1.z.string().uuid("Invalid Variation ID"),
    // الحقل الأساسي (Required)
    optionName: zod_1.z.string().min(1, "Option name is required").max(255),
    // الحقول الاختيارية والـ Defaults
    optionNameAr: zod_1.z.string().max(255).optional(),
    optionNameFr: zod_1.z.string().max(255).optional(),
    // السعر الإضافي متسجل كـ varchar فبنتعامل معاه كـ string
    additionalPrice: zod_1.z.string().max(255).optional(),
    status: zod_1.z.boolean().optional(),
});
exports.updateVariationOptionSchema = exports.createVariationOptionSchema.partial();
