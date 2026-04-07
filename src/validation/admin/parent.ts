// validations/admin.validation.ts

import { z } from "zod";

export const adminSchema = z.object({
    name: z.string().min(2, "name must be at least 2 characters").max(255),
    email: z.string().email("email is not valid"),
    phoneNumber: z.string().regex(/^01[0125][0-9]{8}$/, "phone number is not valid"),
    password: z.string().min(8, "password must be at least 8 characters"),
    status: z.enum(["active", "inactive"], {
        errorMap: () => ({ message: "status is not valid" })
    }).optional()
});

export const updateAdminSchema = z.object({
    name: z.string().min(2, "name must be at least 2 characters").max(255).optional(),
    email: z.string().email("email is not valid").optional(),
    phoneNumber: z.string().regex(/^01[0125][0-9]{8}$/, "phone number is not valid").optional(),
    status: z.enum(["active", "inactive"], {
        errorMap: () => ({ message: "status is not valid" })
    }).optional(),
    oldPassword: z.string().optional(),
    newPassword: z.string().min(8, "password must be at least 8 characters").optional()
}).refine((data) => {
    if (data.newPassword && !data.oldPassword) {
        return false;
    }
    return true;
}, {
    message: "old password is required to change password",
    path: ["oldPassword"]
});

export const adminIdSchema = z.object({
    id: z.string().uuid("id is not valid")
});
