import { z } from "zod";

export const createRestaurantAdminSchema = z.object({
    // العلاقات الأساسية
    restaurantId: z.string().uuid("Invalid Restaurant ID"),
    branchId: z.string().uuid("Invalid Branch ID").optional(),
    roleId: z.string().uuid("Invalid Role ID").optional(),

    // بيانات المستخدم (Required)
    name: z.string().min(1, "Name is required").max(255),
    email: z.string().email("Invalid email format").max(255),
    password: z.string().min(6, "Password must be at least 6 characters").max(255),
    phoneNumber: z.string().min(1, "Phone number is required").max(255),

    // الحقول الاختيارية والـ Defaults
    type: z.enum(["subadmin", "branch_manager"]).optional(),
    permissions: z.array(z.any()).optional(), // تقدر تستبدل z.any() بالـ schema بتاع الـ Permission لو عندك
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateRestaurantAdminSchema = createRestaurantAdminSchema.partial();