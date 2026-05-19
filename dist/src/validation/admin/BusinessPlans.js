"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBusinessPlanSchema = exports.createBusinessPlanSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// Restaurant Business Plans Validation
// ==========================================
exports.createBusinessPlanSchema = zod_1.z.object({
    // الحقول الأساسية والعلاقات (Required)
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
    platformType: zod_1.z.enum(["online_order", "food_aggregator", "mykeeto"], {
        required_error: "Platform type is required",
        invalid_type_error: "Platform type must be either 'online_order' or 'food_aggregator' or 'mykeeto'",
    }),
    // الاشتراكات الشهرية
    isMonthlyActive: zod_1.z.boolean().optional(),
    monthlyAmount: zod_1.z.coerce.string().optional(), // coerce.string عشان لو الفرونت بعتها رقم تتحول لـ string لضمان توافقها مع الـ Decimal
    // الاشتراكات الربع سنوية
    isQuarterlyActive: zod_1.z.boolean().optional(),
    quarterlyAmount: zod_1.z.coerce.string().optional(),
    // الاشتراكات السنوية
    isAnnuallyActive: zod_1.z.boolean().optional(),
    annuallyAmount: zod_1.z.coerce.string().optional(),
    // العمولات والرسوم
    commissionRate: zod_1.z.coerce.string().optional(),
    serviceFee: zod_1.z.coerce.string().optional(),
});
// فاليديشن التحديث (Update) - كل الحقول اختيارية
exports.updateBusinessPlanSchema = exports.createBusinessPlanSchema.partial();
