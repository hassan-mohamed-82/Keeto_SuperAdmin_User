"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRestaurantSchema = exports.createRestaurantSchema = void 0;
const zod_1 = require("zod");
const fileOrString = zod_1.z.any();
exports.createRestaurantSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Name is required").max(255),
    nameAr: zod_1.z.string().max(255).optional(),
    nameFr: zod_1.z.string().max(255).optional(),
    address: zod_1.z.string().min(1, "Address is required"),
    addressAr: zod_1.z.string().optional(),
    addressFr: zod_1.z.string().optional(),
    cuisineId: zod_1.z.string().uuid("Invalid Cuisine ID").optional(),
    zoneId: zod_1.z.string().uuid("Invalid Zone ID"),
    // 🚀 التعديل هنا لضمان عدم ضرب إيرور Validation بسبب الـ Base64
    logo: fileOrString,
    cover: fileOrString.optional(),
    minDeliveryTime: zod_1.z.string().max(50).optional(),
    maxDeliveryTime: zod_1.z.string().max(50).optional(),
    deliveryTimeUnit: zod_1.z.string().max(50).optional(),
    ownerFirstName: zod_1.z.string().min(1, "Owner first name is required").max(255),
    ownerLastName: zod_1.z.string().min(1, "Owner last name is required").max(255),
    ownerPhone: zod_1.z.string().min(1, "Owner phone is required").max(50),
    tags: zod_1.z.array(zod_1.z.string()).optional(),
    taxNumber: zod_1.z.string().max(255).optional(),
    taxExpireDate: zod_1.z.coerce.date().optional(),
    taxCertificate: fileOrString.optional(),
    addhome: zod_1.z.boolean().optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateRestaurantSchema = exports.createRestaurantSchema.partial();
