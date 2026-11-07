import { z } from "zod";
import { egyptPhoneSchema, optionalEgyptPhoneSchema } from "./phone";

export const signupSchema = z.object({
    name: z.string({ required_error: "Name is required" }).min(2, "Name must be at least 2 characters"),
    email: z.string({ required_error: "Email is required" }).email("Invalid email format"),
    phone: egyptPhoneSchema,
    alternatePhone: optionalEgyptPhoneSchema,
    alternativePhone: optionalEgyptPhoneSchema,
    password: z.string({ required_error: "Password is required" }).min(6, "Password must be at least 6 characters"),
    photo: z.string().optional().nullable(),
    restaurantId: z.string().optional().nullable(),
});

export type SignupInput = z.infer<typeof signupSchema>;

