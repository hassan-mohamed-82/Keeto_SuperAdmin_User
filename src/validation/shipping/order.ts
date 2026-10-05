import { z } from "zod";

export const assignOrderDeliveryManSchema = z.object({
    deliveryManId: z.string().uuid("Invalid Delivery Man ID"),
});

export const autoAssignOrderSchema = z.object({
    maxRadiusKm: z.coerce.number().positive().optional(),
});

export const filterShippingOrdersSchema = z.object({
    restaurantId: z.string().uuid("Invalid Restaurant ID").optional(),
    branchId: z.string().uuid("Invalid Branch ID").optional(),
    status: z.enum([
        "pending",
        "accepted",
        "preparing",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "refund",
        "failed"
    ]).optional(),
    deliveryManId: z.string().uuid("Invalid Delivery Man ID").optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
});
