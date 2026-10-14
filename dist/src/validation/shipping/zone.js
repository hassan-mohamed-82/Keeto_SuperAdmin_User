"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateShippingZoneSchema = exports.createShippingZoneSchema = void 0;
const zod_1 = require("zod");
const coordinatePointSchema = zod_1.z.object({
    lat: zod_1.z.number().min(-90).max(90),
    lng: zod_1.z.number().min(-180).max(180),
});
exports.createShippingZoneSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Name is required").max(255),
    nameAr: zod_1.z.string().max(255).optional(),
    coordinates: zod_1.z.array(coordinatePointSchema).min(3, "A zone polygon must contain at least 3 points"),
    coverageAreaRadiusKm: zod_1.z.coerce.string().optional(),
    deliveryFee: zod_1.z.coerce.string().default("0.00"),
    minOrderAmount: zod_1.z.coerce.string().default("0.00"),
    status: zod_1.z.enum(["active", "inactive"]).optional().default("active"),
});
exports.updateShippingZoneSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(255).optional(),
    nameAr: zod_1.z.string().max(255).optional(),
    coordinates: zod_1.z.array(coordinatePointSchema).min(3, "A zone polygon must contain at least 3 points").optional(),
    coverageAreaRadiusKm: zod_1.z.coerce.string().optional(),
    deliveryFee: zod_1.z.coerce.string().optional(),
    minOrderAmount: zod_1.z.coerce.string().optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
