"use strict";
// validations/admin.validation.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminIdSchema = exports.updateAdminSchema = exports.adminSchema = void 0;
const zod_1 = require("zod");
exports.adminSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, "name must be at least 2 characters").max(255),
    email: zod_1.z.string().email("email is not valid"),
    phoneNumber: zod_1.z.string().regex(/^01[0125][0-9]{8}$/, "phone number is not valid"),
    password: zod_1.z.string().min(8, "password must be at least 8 characters"),
    status: zod_1.z.enum(["active", "inactive"], {
        errorMap: () => ({ message: "status is not valid" })
    }).optional()
});
exports.updateAdminSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, "name must be at least 2 characters").max(255).optional(),
    email: zod_1.z.string().email("email is not valid").optional(),
    phoneNumber: zod_1.z.string().regex(/^01[0125][0-9]{8}$/, "phone number is not valid").optional(),
    status: zod_1.z.enum(["active", "inactive"], {
        errorMap: () => ({ message: "status is not valid" })
    }).optional(),
    oldPassword: zod_1.z.string().optional(),
    newPassword: zod_1.z.string().min(8, "password must be at least 8 characters").optional()
}).refine((data) => {
    if (data.newPassword && !data.oldPassword) {
        return false;
    }
    return true;
}, {
    message: "old password is required to change password",
    path: ["oldPassword"]
});
exports.adminIdSchema = zod_1.z.object({
    id: zod_1.z.string().uuid("id is not valid")
});
