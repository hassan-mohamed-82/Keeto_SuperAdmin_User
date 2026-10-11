import { z } from "zod";

export const checkFirstOrderDiscountQuerySchema = z.object({
    restaurantId: z.string().min(1, "restaurantId is required"),
    subtotal: z.coerce.number().min(0).optional(),
});
