import { z } from "zod";

const coordinatePointSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
});

export const createShippingZoneSchema = z.object({
    name: z.string().min(1, "Name is required").max(255),
    nameAr: z.string().max(255).optional(),
    coordinates: z.array(coordinatePointSchema).min(3, "A zone polygon must contain at least 3 points"),
    coverageAreaRadiusKm: z.coerce.string().optional(),
    deliveryFee: z.coerce.string().default("0.00"),
    minOrderAmount: z.coerce.string().default("0.00"),
    status: z.enum(["active", "inactive"]).optional().default("active"),
});

export const updateShippingZoneSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    nameAr: z.string().max(255).optional(),
    coordinates: z.array(coordinatePointSchema).min(3, "A zone polygon must contain at least 3 points").optional(),
    coverageAreaRadiusKm: z.coerce.string().optional(),
    deliveryFee: z.coerce.string().optional(),
    minOrderAmount: z.coerce.string().optional(),
    status: z.enum(["active", "inactive"]).optional(),
});
