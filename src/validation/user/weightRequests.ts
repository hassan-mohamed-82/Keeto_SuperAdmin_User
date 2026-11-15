import { z } from "zod";

export const sendWeightRequestSchema = z.object({
    restaurantId: z.string().uuid("Invalid restaurant ID").optional(),
});

export const cancelWeightRequestSchema = z.object({
    reason: z.string().max(500, "Reason cannot exceed 500 characters").optional(),
});

export const getWeightRequestParamSchema = z.object({
    id: z.string().uuid("Invalid weight request ID"),
});
