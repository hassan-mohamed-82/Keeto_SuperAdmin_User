import { z } from "zod";

// ==========================================
// User Bundle Offers Validation Schemas
// ==========================================

// ------------------------------------------
// 1. GET /  — optional filters
// ------------------------------------------
export const getAllBundlesQuerySchema = z.object({
    restaurantId: z.string().uuid("restaurantId must be a valid UUID").optional(),
    page: z
        .union([z.number().int().positive(), z.string().transform((v) => parseInt(v, 10))])
        .refine((v) => !isNaN(v) && v > 0, { message: "page must be a positive integer" })
        .optional(),
    limit: z
        .union([z.number().int().positive(), z.string().transform((v) => parseInt(v, 10))])
        .refine((v) => !isNaN(v) && v > 0 && v <= 100, { message: "limit must be between 1 and 100" })
        .optional(),
});

// ------------------------------------------
// 2. GET /bundles/:id
// ------------------------------------------
export const getBundleByIdParamsSchema = z.object({
    id: z.string().uuid("id must be a valid UUID"),
});
