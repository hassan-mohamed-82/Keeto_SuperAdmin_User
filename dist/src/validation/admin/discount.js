"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateDiscountSchema = exports.createDiscountSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// Discounts Validation
// ==========================================
exports.createDiscountSchema = zod_1.z.object({
    // الحقول الأساسية (Required)
    name: zod_1.z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    discountType: zod_1.z.enum(["percentage", "fixed_amount"], {
        required_error: "Discount type is required (percentage | fixed_amount)"
    }),
    discountValue: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).refine(val => {
        const num = typeof val === 'number' ? val : parseFloat(val);
        return !isNaN(num) && num >= 0;
    }, { message: "Discount value must be a non-negative number" }),
    // الحقول الاختيارية (عشان ليها default values في الداتا بيز)
    nameAr: zod_1.z.string().max(255).optional().nullable(),
    nameFr: zod_1.z.string().max(255).optional().nullable(),
    maxDiscount: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).optional().nullable(),
    minOrderAmount: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).optional().nullable(),
    usageLimit: zod_1.z.number().int().optional().nullable(),
    startDate: zod_1.z.coerce.date().optional().nullable(),
    endDate: zod_1.z.coerce.date().optional().nullable(),
    isActive: zod_1.z.boolean().optional(),
    restaurantIds: zod_1.z.array(zod_1.z.string().uuid("Invalid Restaurant ID")).optional(),
});
// فاليديشن التحديث (Update) - كل الحقول هتكون اختيارية
exports.updateDiscountSchema = exports.createDiscountSchema.partial();
