import { z } from "zod";

// ==========================================
// Restaurant Groups Validation Schemas
// ==========================================

export const createRestaurantGroupSchema = z.object({
    name: z.string().min(1, "Name is required").max(255, "Name cannot exceed 255 characters"),
    nameAr: z.string().max(255).optional().default(""),
    nameFr: z.string().max(255).optional().default(""),
    restaurants: z.array(z.string().min(1, "Restaurant ID cannot be empty")).default([]),

    // نوع التغطية المعتمد
    coverageType: z.enum(["POLYGON", "RADIUS"]).optional().default("POLYGON"),

    // الداتا المخصصة (نقاط أو نصف قطر)
    customCoordinates: z
        .array(
            z.object({
                lat: z.number({ required_error: "lat is required" }),
                lng: z.number({ required_error: "lng is required" }),
            })
        )
        .optional()
        .nullable(),

    customRadiusKm: z.union([z.number(), z.string()]).optional().nullable(),

    status: z.enum(["active", "inactive"]).optional().default("active"),
});

// Update schema (all fields optional)
export const updateRestaurantGroupSchema = createRestaurantGroupSchema.partial();

