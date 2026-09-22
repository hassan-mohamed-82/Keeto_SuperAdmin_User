"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateRestaurantGroupSchema = exports.createRestaurantGroupSchema = exports.restaurantGroupBannerSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// Restaurant Groups Validation Schemas
// ==========================================
exports.restaurantGroupBannerSchema = zod_1.z.object({
    image: zod_1.z.string().min(1, "Banner image is required"),
    link: zod_1.z.string().optional().nullable().default(null),
    order: zod_1.z.number().int().optional().default(0),
});
exports.createRestaurantGroupSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    nameAr: zod_1.z.string().max(255).optional().default(""),
    nameFr: zod_1.z.string().max(255).optional().default(""),
    restaurants: zod_1.z.array(zod_1.z.string().min(1, "Restaurant ID cannot be empty")).default([]),
    // نوع التغطية المعتمد
    coverageType: zod_1.z.enum(["POLYGON", "RADIUS"]).optional().default("POLYGON"),
    // الداتا المخصصة (نقاط أو نصف قطر)
    customCoordinates: zod_1.z
        .array(zod_1.z.object({
        lat: zod_1.z.number({ required_error: "lat is required" }),
        lng: zod_1.z.number({ required_error: "lng is required" }),
    }))
        .optional()
        .nullable(),
    customRadiusKm: zod_1.z.union([zod_1.z.number(), zod_1.z.string()]).optional().nullable(),
    // قائمة البانرات
    banners: zod_1.z.array(exports.restaurantGroupBannerSchema).optional().default([]),
    status: zod_1.z.enum(["active", "inactive"]).optional().default("active"),
});
// Update schema (all fields optional)
exports.updateRestaurantGroupSchema = exports.createRestaurantGroupSchema.partial();
