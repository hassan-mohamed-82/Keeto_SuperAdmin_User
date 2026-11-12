import { z } from "zod";

export const sendForWeighingSchema = z.object({
    restaurantId: z.string().uuid("Invalid restaurant ID").optional(),
});

export const addToCartSchema = z.object({
    foodId: z.string().uuid("Invalid food ID").optional(),
    offerId: z.string().uuid("Invalid offer ID").optional(),
    quantity: z.coerce.number().int().min(1).optional().default(1),
    weight: z.coerce.number().positive("Weight must be greater than 0").optional(),
    variations: z.array(z.any()).optional(),
    addons: z.array(z.any()).optional(),
    note: z.string().max(500).optional(),
    branchId: z.string().uuid("Invalid branch ID").optional(),
    addressId: z.string().uuid("Invalid address ID").optional(),
    serviceModule: z.enum(["takeaway", "dine_in", "delivery"]).optional(),
});

export const updateCartItemSchema = z.object({
    quantity: z.coerce.number().int().min(1).optional(),
    weight: z.coerce.number().positive("Weight must be greater than 0").optional(),
    variations: z.array(z.any()).optional(),
    addons: z.array(z.any()).optional(),
    note: z.string().max(500).optional().nullable(),
    branchId: z.string().uuid("Invalid branch ID").optional(),
    addressId: z.string().uuid("Invalid address ID").optional(),
    serviceModule: z.enum(["takeaway", "dine_in", "delivery"]).optional(),
});
