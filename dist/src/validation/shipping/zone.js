"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateShippingZoneSchema = exports.createShippingZoneSchema = void 0;
const zod_1 = require("zod");
exports.createShippingZoneSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Name is required").max(255),
    nameAr: zod_1.z.string().max(255).optional(),
    coordinates: zod_1.z.array(zod_1.z.object({
        lat: zod_1.z.number(),
        lng: zod_1.z.number(),
    })).optional(),
    coverageAreaRadiusKm: zod_1.z.coerce.string().optional(),
    deliveryFee: zod_1.z.coerce.string().optional(),
    minOrderAmount: zod_1.z.coerce.string().optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional().default("active"),
});
exports.updateShippingZoneSchema = exports.createShippingZoneSchema.partial();
