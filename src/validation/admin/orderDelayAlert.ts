import { z } from "zod";

const normalizeToArray = (val: unknown): unknown => {
    if (typeof val === "string") {
        try {
            const parsed = JSON.parse(val);
            return Array.isArray(parsed) ? parsed : [val];
        } catch {
            return [val];
        }
    }
    if (Array.isArray(val)) return val;
    return val;
};

export const orderDelayAlertGroupBaseSchema = z.object({
    restaurantId: z
        .string()
        .uuid("صيغة معرف المطعم غير صالحة")
        .optional()
        .nullable(),

    isSuperAdmin: z.boolean().optional().default(false),

    name: z
        .string({ required_error: "اسم المجموعة مطلوب" })
        .min(1, "اسم المجموعة لا يمكن أن يكون فارغاً")
        .max(255, "اسم المجموعة طويل جداً"),

    emails: z.preprocess(
        normalizeToArray,
        z
            .array(z.string().email("البريد الإلكتروني غير صالح"))
            .min(1, "يجب إدخال بريد إلكتروني واحد على الأقل")
    ),

    // للمطاعم
    allBranches: z.boolean().optional().default(true),
    branchIds: z.preprocess(
        normalizeToArray,
        z.array(z.string().min(1)).optional().default([])
    ),

    // للسوبر أدمن
    allRestaurants: z.boolean().optional().default(true),
    restaurantIds: z.preprocess(
        normalizeToArray,
        z.array(z.string().min(1)).optional().default([])
    ),

    maxDelayMinutes: z
        .coerce
        .number({ required_error: "أقصى وقت لتأخير الأوردر مطلوب" })
        .int("مدة التأخير يجب أن تكون رقماً صحيحاً")
        .min(1, "مدة التأخير يجب أن تكون دقيقة واحدة على الأقل"),

    orderStatus: z.preprocess(
        normalizeToArray,
        z.array(z.enum(["pending", "accepted", "preparing", "out_for_delivery"])).default(["pending"])
    ),

    isActive: z.boolean().optional().default(true),
});

export const createOrderDelayAlertGroupSchema = orderDelayAlertGroupBaseSchema
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

export const updateOrderDelayAlertGroupSchema = orderDelayAlertGroupBaseSchema.partial();