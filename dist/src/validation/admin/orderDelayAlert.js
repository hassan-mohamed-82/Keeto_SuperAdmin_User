"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateOrderDelayAlertGroupSchema = exports.createOrderDelayAlertGroupSchema = exports.orderDelayAlertGroupBaseSchema = void 0;
const zod_1 = require("zod");
const normalizeToArray = (val) => {
    if (typeof val === "string") {
        try {
            const parsed = JSON.parse(val);
            return Array.isArray(parsed) ? parsed : [val];
        }
        catch {
            return [val];
        }
    }
    if (Array.isArray(val))
        return val;
    return val;
};
exports.orderDelayAlertGroupBaseSchema = zod_1.z.object({
    restaurantId: zod_1.z
        .string()
        .uuid("صيغة معرف المطعم غير صالحة")
        .optional()
        .nullable(),
    isSuperAdmin: zod_1.z.boolean().optional().default(false),
    name: zod_1.z
        .string({ required_error: "اسم المجموعة مطلوب" })
        .min(1, "اسم المجموعة لا يمكن أن يكون فارغاً")
        .max(255, "اسم المجموعة طويل جداً"),
    emails: zod_1.z.preprocess(normalizeToArray, zod_1.z
        .array(zod_1.z.string().email("البريد الإلكتروني غير صالح"))
        .min(1, "يجب إدخال بريد إلكتروني واحد على الأقل")),
    // للمطاعم
    allBranches: zod_1.z.boolean().optional().default(true),
    branchIds: zod_1.z.preprocess(normalizeToArray, zod_1.z.array(zod_1.z.string().min(1)).optional().default([])),
    // للسوبر أدمن
    allRestaurants: zod_1.z.boolean().optional().default(true),
    restaurantIds: zod_1.z.preprocess(normalizeToArray, zod_1.z.array(zod_1.z.string().min(1)).optional().default([])),
    maxDelayMinutes: zod_1.z
        .coerce
        .number({ required_error: "أقصى وقت لتأخير الأوردر مطلوب" })
        .int("مدة التأخير يجب أن تكون رقماً صحيحاً")
        .min(1, "مدة التأخير يجب أن تكون دقيقة واحدة على الأقل"),
    orderStatus: zod_1.z.preprocess(normalizeToArray, zod_1.z.array(zod_1.z.enum(["pending", "accepted", "preparing", "out_for_delivery"])).default(["pending"])),
    isActive: zod_1.z.boolean().optional().default(true),
});
exports.createOrderDelayAlertGroupSchema = exports.orderDelayAlertGroupBaseSchema
    .refine((data) => {
    if (!data.isSuperAdmin && !data.restaurantId) {
        return false;
    }
    return true;
}, {
    message: "معرف المطعم (restaurantId) مطلوب عند إنشاء مجموعة غير تابعة للسوبر أدمن",
    path: ["restaurantId"],
})
    .refine((data) => {
    if (data.isSuperAdmin && data.allRestaurants === false && (!data.restaurantIds || data.restaurantIds.length === 0)) {
        return false;
    }
    return true;
}, {
    message: "يجب اختيار مطعم واحد على الأقل عند تحديد خيار مطاعم محددة",
    path: ["restaurantIds"],
})
    .refine((data) => {
    if (!data.isSuperAdmin && data.allBranches === false && (!data.branchIds || data.branchIds.length === 0)) {
        return false;
    }
    return true;
}, {
    message: "يجب اختيار فرع واحد على الأقل عند تحديد خيار فروع محددة",
    path: ["branchIds"],
});
exports.updateOrderDelayAlertGroupSchema = exports.orderDelayAlertGroupBaseSchema.partial();
