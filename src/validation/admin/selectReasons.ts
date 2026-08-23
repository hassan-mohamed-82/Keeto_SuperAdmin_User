import { z } from "zod";

export const createSelectReasonSchema = z.object({
    name: z.string().min(1, "Reason name is required").max(255),
    name_ar: z.string().optional(),
    name_fr: z.string().optional(),
    type: z.enum(["user","restaurant"]).optional(),
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateSelectReasonSchema = createSelectReasonSchema.partial();