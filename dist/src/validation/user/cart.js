"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCartItemSchema = exports.addToCartSchema = exports.optionalWeightSchema = void 0;
const zod_1 = require("zod");
const phone_1 = require("./phone");
exports.optionalWeightSchema = zod_1.z.preprocess((val) => (val === "" || val === 0 || val === "0" ? null : val), zod_1.z.coerce.number().positive("Weight must be greater than 0").nullable().optional());
exports.addToCartSchema = zod_1.z.object({
    foodId: zod_1.z.string().uuid("Invalid food ID").nullable().optional(),
    offerId: zod_1.z.string().uuid("Invalid offer ID").nullable().optional(),
    quantity: zod_1.z.coerce.number().int().min(1).nullable().optional().default(1),
    weight: exports.optionalWeightSchema,
    variations: zod_1.z.array(zod_1.z.any()).nullable().optional(),
    addons: zod_1.z.array(zod_1.z.any()).nullable().optional(),
    note: zod_1.z.string().max(500).nullable().optional(),
    branchId: zod_1.z.string().uuid("Invalid branch ID").nullable().optional(),
    addressId: zod_1.z.string().uuid("Invalid address ID").nullable().optional(),
    serviceModule: zod_1.z.enum(["takeaway", "dine_in", "delivery"]).nullable().optional(),
    phone: phone_1.optionalEgyptPhoneSchema,
    alternatePhone: phone_1.optionalEgyptPhoneSchema,
    alternativePhone: phone_1.optionalEgyptPhoneSchema,
});
exports.updateCartItemSchema = zod_1.z.object({
    quantity: zod_1.z.coerce.number().int().min(1).nullable().optional(),
    weight: exports.optionalWeightSchema,
    variations: zod_1.z.array(zod_1.z.any()).nullable().optional(),
    addons: zod_1.z.array(zod_1.z.any()).nullable().optional(),
    note: zod_1.z.string().max(500).nullable().optional(),
    branchId: zod_1.z.string().uuid("Invalid branch ID").nullable().optional(),
    addressId: zod_1.z.string().uuid("Invalid address ID").nullable().optional(),
    serviceModule: zod_1.z.enum(["takeaway", "dine_in", "delivery"]).nullable().optional(),
    phone: phone_1.optionalEgyptPhoneSchema,
    alternatePhone: phone_1.optionalEgyptPhoneSchema,
    alternativePhone: phone_1.optionalEgyptPhoneSchema,
});
