import { z } from "zod";
import { optionalEgyptPhoneSchema } from "./phone";

export const updateProfileSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters").nullable().optional(),
    email: z.string().email("Invalid email format").nullable().optional(),
    phone: optionalEgyptPhoneSchema,
    alternatePhone: optionalEgyptPhoneSchema,
    alternativePhone: optionalEgyptPhoneSchema,
    photo: z.string().nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

