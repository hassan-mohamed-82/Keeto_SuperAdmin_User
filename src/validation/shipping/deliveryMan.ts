import { z } from "zod";

export const createDeliveryManSchema = z.object({
    name: z.string().min(1, "Name is required").max(255),
    phone: z.string().min(1, "Phone number is required").max(50),
    email: z.string().email("Invalid email format").max(255).optional(),
    password: z.string().min(6, "Password must be at least 6 characters").max(255).optional(),
    image: z.string().max(500).optional(),
    deliveryType: z.enum(["restaurant", "outsource"]).default("outsource"),
    allZones: z.boolean().default(true),
    zoneIds: z.array(z.string().uuid("Invalid Zone ID")).optional(),
    restaurantId: z.string().uuid("Invalid Restaurant ID").nullable().optional(),
    branchId: z.string().uuid("Invalid Branch ID").nullable().optional(),
}).refine((data) => {
    if (data.allZones === false && (!data.zoneIds || data.zoneIds.length === 0)) {
        return false;
    }
    return true;
}, {
    message: "zoneIds must contain at least one zone when allZones is false",
    path: ["zoneIds"],
});

export const assignExistingDeliveryManSchema = z.object({
    deliveryManId: z.string().uuid("Invalid Delivery Man ID"),
    deliveryType: z.enum(["restaurant", "outsource"]).default("outsource"),
    allZones: z.boolean().default(true),
    zoneIds: z.array(z.string().uuid("Invalid Zone ID")).optional(),
}).refine((data) => {
    if (data.allZones === false && (!data.zoneIds || data.zoneIds.length === 0)) {
        return false;
    }
    return true;
}, {
    message: "zoneIds must contain at least one zone when allZones is false",
    path: ["zoneIds"],
});

export const updateDeliveryManSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    phone: z.string().min(1).max(50).optional(),
    email: z.string().email("Invalid email format").max(255).optional(),
    password: z.string().min(6).max(255).optional(),
    image: z.string().max(500).optional(),
    deliveryType: z.enum(["restaurant", "outsource"]).optional(),
    allZones: z.boolean().optional(),
    shiftStatus: z.enum(["active", "inactive"]).optional(),
    isActive: z.boolean().optional(),
    restaurantId: z.string().uuid().nullable().optional(),
    branchId: z.string().uuid().nullable().optional(),
});

export const toggleDeliveryShiftSchema = z.object({
    shiftStatus: z.enum(["active", "inactive"]),
});

export const updateDeliveryLocationSchema = z.object({
    lat: z.coerce.string().min(1, "Latitude is required"),
    lng: z.coerce.string().min(1, "Longitude is required"),
});

export const setCourierZonesSchema = z.object({
    allZones: z.boolean().default(false),
    zoneIds: z.array(z.string().uuid("Invalid Zone ID")).default([]),
}).refine((data) => {
    if (data.allZones === false && (!data.zoneIds || data.zoneIds.length === 0)) {
        return false;
    }
    return true;
}, {
    message: "zoneIds must contain at least one zone when allZones is false",
    path: ["zoneIds"],
});

export const setCourierShiftsSchema = z.object({
    shifts: z.array(
        z.object({
            restaurantId: z.string().uuid("Invalid Restaurant ID"),
            dayOfWeek: z.number().int().min(0).max(6),
            from: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/, "From time must be HH:MM or HH:MM:SS in 24h format"),
            to: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/, "To time must be HH:MM or HH:MM:SS in 24h format"),
            status: z.enum(["active", "inactive"]).default("active"),
        })
    ),
});
