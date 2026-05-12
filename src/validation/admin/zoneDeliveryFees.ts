import { z } from "zod";

export const createZoneDeliveryFeeSchema = z.object({
    // العلاقات (Required)
    fromZoneId: z.string().uuid("Invalid Source Zone ID"),
    toZoneId: z.string().uuid("Invalid Destination Zone ID"),

    // سعر التوصيل متسجل كـ Decimal، فبنستخدم coerce.string
    fee: z.coerce.string({
        required_error: "Fee is required",
        invalid_type_error: "Fee must be a valid number",
    }).min(1, "Fee cannot be empty"),
});

export const updateZoneDeliveryFeeSchema = createZoneDeliveryFeeSchema.partial();