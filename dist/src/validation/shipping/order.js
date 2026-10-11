"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterShippingOrdersSchema = exports.autoAssignOrderSchema = exports.assignOrderDeliveryManSchema = void 0;
const zod_1 = require("zod");
exports.assignOrderDeliveryManSchema = zod_1.z.object({
    deliveryManId: zod_1.z.string().uuid("Invalid Delivery Man ID"),
});
exports.autoAssignOrderSchema = zod_1.z.object({
    maxRadiusKm: zod_1.z.coerce.number().positive().optional(),
});
exports.filterShippingOrdersSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("Invalid Restaurant ID").optional(),
    branchId: zod_1.z.string().uuid("Invalid Branch ID").optional(),
    status: zod_1.z.enum([
        "pending",
        "accepted",
        "preparing",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "refund",
        "failed"
    ]).optional(),
    deliveryManId: zod_1.z.string().uuid("Invalid Delivery Man ID").optional(),
    page: zod_1.z.coerce.number().int().min(1).optional().default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).optional().default(20),
    fromDate: zod_1.z.string().optional(),
    toDate: zod_1.z.string().optional(),
});
