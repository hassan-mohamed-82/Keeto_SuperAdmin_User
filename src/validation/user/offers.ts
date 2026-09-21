import { z } from "zod";

// ==========================================
// User Offers & Discounts Validation Schemas
// ==========================================

export const getDiscountsWithProductsQuerySchema = z.object({
    restaurantId: z.string().uuid("restaurantId must be a valid UUID").optional(),
    branchId: z.string().uuid("branchId must be a valid UUID").optional(),
    addressId: z.string().uuid("addressId must be a valid UUID").optional(),
    serviceModule: z.enum(["delivery", "takeaway", "dine_in"]).optional(),
});

export const getRestaurantOffersParamsSchema = z.object({
    restaurantId: z.string().uuid("restaurantId must be a valid UUID"),
});

export const getRestaurantDiscountsParamsSchema = z.object({
    restaurantId: z.string().uuid("restaurantId must be a valid UUID"),
});
