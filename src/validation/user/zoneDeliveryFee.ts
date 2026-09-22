import { z } from "zod";

// ============================================================
// Schema: Get Zone & Delivery Fee for a given lat/lng
// ============================================================
export const getZoneDeliveryFeeSchema = z.object({
    restaurantId: z.string().uuid({ message: "restaurantId must be a valid UUID" }),
    lat: z.number({ required_error: "lat is required", invalid_type_error: "lat must be a number" }),
    lng: z.number({ required_error: "lng is required", invalid_type_error: "lng must be a number" }),
    branchId: z.string().uuid({ message: "branchId must be a valid UUID" }).optional(),
});

export type GetZoneDeliveryFeeInput = z.infer<typeof getZoneDeliveryFeeSchema>;
