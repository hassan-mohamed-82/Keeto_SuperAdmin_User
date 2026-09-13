import { z } from "zod";

// ==========================================
// User Restaurant Groups Validation Schemas
// ==========================================

export const getRestaurantGroupsByLocationSchema = z.object({
    lat: z
        .union([z.number(), z.string().transform((v) => parseFloat(v))])
        .refine((v) => !isNaN(v) && v >= -90 && v <= 90, {
            message: "Valid latitude is required (-90 to 90)",
        }),
    lng: z
        .union([z.number(), z.string().transform((v) => parseFloat(v))])
        .refine((v) => !isNaN(v) && v >= -180 && v <= 180, {
            message: "Valid longitude is required (-180 to 180)",
        }),
});
