import { z } from "zod";

export const createDeliveryManSchema = z.object({
    name: z.string().min(1, "Name is required").max(255),
    phone: z.string().min(1, "Phone number is required").max(50),
    email: z.string().email("Invalid email format").max(255).optional(),
    password: z.string().min(6, "Password must be at least 6 characters").max(255).optional(),
    image: z.string().max(500).optional(),
    deliveryType: z.enum(["restaurant", "outsource"]).optional().default("outsource"),
    shiftStatus: z.enum(["active", "inactive"]).optional().default("inactive"),
    branchId: z.string().uuid("Invalid Branch ID").optional(),
    restaurantId: z.string().uuid("Invalid Restaurant ID").optional(),
});

export const assignExistingDeliveryManSchema = z.object({
    deliveryManId: z.string().uuid("Invalid Delivery Man ID"),
    deliveryType: z.enum(["restaurant", "outsource"]).optional().default("outsource"),
});

export const updateDeliveryManSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    phone: z.string().min(1).max(50).optional(),
    email: z.string().email("Invalid email format").max(255).optional(),
    password: z.string().min(6).max(255).optional(),
    image: z.string().max(500).optional(),
    deliveryType: z.enum(["restaurant", "outsource"]).optional(),
    shiftStatus: z.enum(["active", "inactive"]).optional(),
    isOnline: z.boolean().optional(),
    isAvailable: z.boolean().optional(),
    isActive: z.boolean().optional(),
    branchId: z.string().uuid().nullable().optional(),
    restaurantId: z.string().uuid().nullable().optional(),
});

export const toggleDeliveryShiftSchema = z.object({
    shiftStatus: z.enum(["active", "inactive"]),
});

export const updateDeliveryLocationSchema = z.object({
    lat: z.coerce.string().min(1, "Latitude is required"),
    lng: z.coerce.string().min(1, "Longitude is required"),
});
