"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setCourierShiftsSchema = exports.setCourierZonesSchema = exports.updateDeliveryLocationSchema = exports.toggleDeliveryShiftSchema = exports.updateDeliveryManSchema = exports.assignExistingDeliveryManSchema = exports.createDeliveryManSchema = void 0;
const zod_1 = require("zod");
exports.createDeliveryManSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Name is required").max(255),
    phone: zod_1.z.string().min(1, "Phone number is required").max(50),
    email: zod_1.z.string().email("Invalid email format").max(255).optional(),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters").max(255).optional(),
    image: zod_1.z.string().max(500).optional(),
    deliveryType: zod_1.z.enum(["restaurant", "outsource"]).default("outsource"),
    allZones: zod_1.z.boolean().default(true),
    zoneIds: zod_1.z.array(zod_1.z.string().uuid("Invalid Zone ID")).optional(),
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID").nullable().optional(),
    branchId: zod_1.z.string().uuid("Invalid Branch ID").nullable().optional(),
}).refine((data) => {
    if (data.allZones === false && (!data.zoneIds || data.zoneIds.length === 0)) {
        return false;
    }
    return true;
}, {
    message: "zoneIds must contain at least one zone when allZones is false",
    path: ["zoneIds"],
});
exports.assignExistingDeliveryManSchema = zod_1.z.object({
    deliveryManId: zod_1.z.string().uuid("Invalid Delivery Man ID"),
    deliveryType: zod_1.z.enum(["restaurant", "outsource"]).default("outsource"),
    allZones: zod_1.z.boolean().default(true),
    zoneIds: zod_1.z.array(zod_1.z.string().uuid("Invalid Zone ID")).optional(),
}).refine((data) => {
    if (data.allZones === false && (!data.zoneIds || data.zoneIds.length === 0)) {
        return false;
    }
    return true;
}, {
    message: "zoneIds must contain at least one zone when allZones is false",
    path: ["zoneIds"],
});
exports.updateDeliveryManSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(255).optional(),
    phone: zod_1.z.string().min(1).max(50).optional(),
    email: zod_1.z.string().email("Invalid email format").max(255).optional(),
    password: zod_1.z.string().min(6).max(255).optional(),
    image: zod_1.z.string().max(500).optional(),
    deliveryType: zod_1.z.enum(["restaurant", "outsource"]).optional(),
    allZones: zod_1.z.boolean().optional(),
    shiftStatus: zod_1.z.enum(["active", "inactive"]).optional(),
    isActive: zod_1.z.boolean().optional(),
    restaurantId: zod_1.z.string().uuid().nullable().optional(),
    branchId: zod_1.z.string().uuid().nullable().optional(),
});
exports.toggleDeliveryShiftSchema = zod_1.z.object({
    shiftStatus: zod_1.z.enum(["active", "inactive"]),
});
exports.updateDeliveryLocationSchema = zod_1.z.object({
    lat: zod_1.z.coerce.string().min(1, "Latitude is required"),
    lng: zod_1.z.coerce.string().min(1, "Longitude is required"),
});
exports.setCourierZonesSchema = zod_1.z.object({
    allZones: zod_1.z.boolean().default(false),
    zoneIds: zod_1.z.array(zod_1.z.string().uuid("Invalid Zone ID")).default([]),
}).refine((data) => {
    if (data.allZones === false && (!data.zoneIds || data.zoneIds.length === 0)) {
        return false;
    }
    return true;
}, {
    message: "zoneIds must contain at least one zone when allZones is false",
    path: ["zoneIds"],
});
exports.setCourierShiftsSchema = zod_1.z.object({
    shifts: zod_1.z.array(zod_1.z.object({
        restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID"),
        dayOfWeek: zod_1.z.number().int().min(0).max(6),
        from: zod_1.z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/, "From time must be HH:MM or HH:MM:SS in 24h format"),
        to: zod_1.z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/, "To time must be HH:MM or HH:MM:SS in 24h format"),
        status: zod_1.z.enum(["active", "inactive"]).default("active"),
    })),
});
