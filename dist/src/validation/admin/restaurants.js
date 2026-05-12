"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRestaurantSchema = exports.createRestaurantSchema = void 0;
const zod_1 = require("zod");
exports.createRestaurantSchema = zod_1.z.object({
    // 1. Restaurant Info & Location
    name: zod_1.z.string().min(1, "Name is required").max(255),
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    address: zod_1.z.string().min(1, "Address is required"),
    addressAr: zod_1.z.string().optional(),
    addressFr: zod_1.z.string().optional(),
    cuisineId: zod_1.z.string().uuid("Invalid Cuisine ID").optional(), // Optional حسب الـ Schema
    zoneId: zod_1.z.string().uuid("Invalid Zone ID"),
    logo: zod_1.z.string().min(1, "Logo is required").max(500),
    cover: zod_1.z.string().max(500).optional(),
    // 2. Delivery & Owner Info
    minDeliveryTime: zod_1.z.string().max(50).optional(),
    maxDeliveryTime: zod_1.z.string().max(50).optional(),
    deliveryTimeUnit: zod_1.z.string().max(50).optional(),
    ownerFirstName: zod_1.z.string().min(1, "Owner first name is required").max(255),
    ownerLastName: zod_1.z.string().min(1, "Owner last name is required").max(255),
    ownerPhone: zod_1.z.string().min(1, "Owner phone is required").max(50),
    // التاجز (مصفوفة من النصوص)
    tags: zod_1.z.array(zod_1.z.string()).optional(),
    // 3. Business TIN & Account Info
    taxNumber: zod_1.z.string().max(255).optional(),
    taxExpireDate: zod_1.z.coerce.date().optional(), // بيحول النص لتاريخ
    taxCertificate: zod_1.z.string().max(255).optional(),
    email: zod_1.z.string().email("Invalid email address").max(255),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters").max(255),
    // 💡 ممكن تزود تأكيد الباسورد كده وتعمل Refine لو هتستخدمها في الـ Controller مباشرة
    // confirmPassword: z.string().optional(),
    type: zod_1.z.enum(["restaurantadmin", "superadmin"]).optional(),
    addhome: zod_1.z.boolean().optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateRestaurantSchema = exports.createRestaurantSchema.partial();
