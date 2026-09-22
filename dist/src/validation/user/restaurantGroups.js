"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRestaurantGroupsByLocationSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// User Restaurant Groups Validation Schemas
// ==========================================
exports.getRestaurantGroupsByLocationSchema = zod_1.z.object({
    lat: zod_1.z
        .union([zod_1.z.number(), zod_1.z.string().transform((v) => parseFloat(v))])
        .refine((v) => !isNaN(v) && v >= -90 && v <= 90, {
        message: "Valid latitude is required (-90 to 90)",
    }),
    lng: zod_1.z
        .union([zod_1.z.number(), zod_1.z.string().transform((v) => parseFloat(v))])
        .refine((v) => !isNaN(v) && v >= -180 && v <= 180, {
        message: "Valid longitude is required (-180 to 180)",
    }),
});
