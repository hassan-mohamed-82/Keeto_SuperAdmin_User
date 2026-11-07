"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signupSchema = void 0;
const zod_1 = require("zod");
const phone_1 = require("./phone");
exports.signupSchema = zod_1.z.object({
    name: zod_1.z.string({ required_error: "Name is required" }).min(2, "Name must be at least 2 characters"),
    email: zod_1.z.string({ required_error: "Email is required" }).email("Invalid email format"),
    phone: phone_1.egyptPhoneSchema,
    alternatePhone: phone_1.optionalEgyptPhoneSchema,
    alternativePhone: phone_1.optionalEgyptPhoneSchema,
    password: zod_1.z.string({ required_error: "Password is required" }).min(6, "Password must be at least 6 characters"),
    photo: zod_1.z.string().optional().nullable(),
    restaurantId: zod_1.z.string().optional().nullable(),
});
