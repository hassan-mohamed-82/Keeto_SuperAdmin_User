import { z } from "zod";

// ==========================================
// User Food / Product Validation Schemas
// ==========================================

export const getFoodByIdParamsSchema = z.object({
    id: z.string().uuid("Product ID must be a valid UUID"),
});

export const getFoodByIdQuerySchema = z.object({
    branchId: z.string().uuid("branchId must be a valid UUID").optional(),
    addressId: z.string().uuid("addressId must be a valid UUID").optional(),
    serviceModule: z.enum(["delivery", "takeaway", "dine_in"]).optional(),
});
