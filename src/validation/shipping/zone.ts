import { z } from "zod";

export const createShippingZoneSchema = z.object({
    name: z.string().min(1, "Name is required").max(255),
    nameAr: z.string().max(255).optional(),
    coordinates: z.array(
        z.object({
            lat: z.number(),
            lng: z.number(),
        })
    ).optional(),
    coverageAreaRadiusKm: z.coerce.string().optional(),
    deliveryFee: z.coerce.string().optional(),
    minOrderAmount: z.coerce.string().optional(),
    status: z.enum(["active", "inactive"]).optional().default("active"),
});

export const updateShippingZoneSchema = createShippingZoneSchema.partial();
