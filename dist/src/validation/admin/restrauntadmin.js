"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRestaurantAdminSchema = exports.createRestaurantAdminSchema = void 0;
const zod_1 = require("zod");
exports.createRestaurantAdminSchema = zod_1.z.object({
    // العلاقات الأساسية
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
    branchId: zod_1.z.string().uuid("Invalid Branch ID").optional(),
    roleId: zod_1.z.string().uuid("Invalid Role ID").optional(),
    // بيانات المستخدم (Required)
    name: zod_1.z.string().min(1, "Name is required").max(255),
    email: zod_1.z.string().email("Invalid email format").max(255),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters").max(255),
    phoneNumber: zod_1.z.string().min(1, "Phone number is required").max(255),
    // الحقول الاختيارية والـ Defaults
    type: zod_1.z.enum(["subadmin", "branch_manager"]).optional(),
    permissions: zod_1.z.array(zod_1.z.any()).optional(), // تقدر تستبدل z.any() بالـ schema بتاع الـ Permission لو عندك
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateRestaurantAdminSchema = exports.createRestaurantAdminSchema.partial();
