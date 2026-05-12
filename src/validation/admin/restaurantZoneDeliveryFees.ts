import { z } from "zod";

export const createZoneDeliveryFeeSchema = z.object({
    restaurantId: z.string().uuid("Invalid Restaurant ID"),
    zoneId: z.string().uuid("Invalid Zone ID"),
    
    deliveryFee: z.coerce.string({
        required_error: "Delivery fee is required",
        invalid_type_error: "Delivery fee must be a valid number",
    }).min(1, "Delivery fee cannot be empty"),
    
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateZoneDeliveryFeeSchema = createZoneDeliveryFeeSchema.partial();