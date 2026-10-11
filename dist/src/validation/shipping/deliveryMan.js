"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateDeliveryLocationSchema = exports.toggleDeliveryShiftSchema = exports.updateDeliveryManSchema = exports.assignExistingDeliveryManSchema = exports.createDeliveryManSchema = void 0;
const zod_1 = require("zod");
exports.createDeliveryManSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, "Name is required").max(255),
    phone: zod_1.z.string().min(1, "Phone number is required").max(50),
    email: zod_1.z.string().email("Invalid email format").max(255).optional(),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters").max(255).optional(),
    image: zod_1.z.string().max(500).optional(),
    deliveryType: zod_1.z.enum(["restaurant", "outsource"]).optional().default("outsource"),
    shiftStatus: zod_1.z.enum(["active", "inactive"]).optional().default("inactive"),
    branchId: zod_1.z.string().uuid("Invalid Branch ID").optional(),
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID").optional(),
});
exports.assignExistingDeliveryManSchema = zod_1.z.object({
    deliveryManId: zod_1.z.string().uuid("Invalid Delivery Man ID"),
    deliveryType: zod_1.z.enum(["restaurant", "outsource"]).optional().default("outsource"),
});
exports.updateDeliveryManSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(255).optional(),
    phone: zod_1.z.string().min(1).max(50).optional(),
    email: zod_1.z.string().email("Invalid email format").max(255).optional(),
    password: zod_1.z.string().min(6).max(255).optional(),
    image: zod_1.z.string().max(500).optional(),
    deliveryType: zod_1.z.enum(["restaurant", "outsource"]).optional(),
    shiftStatus: zod_1.z.enum(["active", "inactive"]).optional(),
    isOnline: zod_1.z.boolean().optional(),
    isAvailable: zod_1.z.boolean().optional(),
    isActive: zod_1.z.boolean().optional(),
    branchId: zod_1.z.string().uuid().nullable().optional(),
    restaurantId: zod_1.z.string().uuid().nullable().optional(),
});
exports.toggleDeliveryShiftSchema = zod_1.z.object({
    shiftStatus: zod_1.z.enum(["active", "inactive"]),
});
exports.updateDeliveryLocationSchema = zod_1.z.object({
    lat: zod_1.z.coerce.string().min(1, "Latitude is required"),
    lng: zod_1.z.coerce.string().min(1, "Longitude is required"),
});
