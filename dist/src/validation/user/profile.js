"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProfileSchema = void 0;
const zod_1 = require("zod");
const phone_1 = require("./phone");
exports.updateProfileSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, "Name must be at least 2 characters").optional(),
    email: zod_1.z.string().email("Invalid email format").optional(),
    phone: phone_1.optionalEgyptPhoneSchema,
    alternatePhone: phone_1.optionalEgyptPhoneSchema,
    alternativePhone: phone_1.optionalEgyptPhoneSchema,
    photo: zod_1.z.string().optional().nullable(),
});
