import { z } from "zod";

export const createSelectReasonSchema = z.object({
    name: z.string().min(1, "Reason name is required").max(255),
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateSelectReasonSchema = createSelectReasonSchema.partial();