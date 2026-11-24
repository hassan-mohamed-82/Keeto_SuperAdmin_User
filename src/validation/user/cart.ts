import { z } from "zod";
import { optionalEgyptPhoneSchema } from "./phone";

export const optionalWeightSchema = z.preprocess(
    (val) => (val === "" || val === 0 || val === "0" ? null : val),
    z.coerce.number().positive("Weight must be greater than 0").nullable().optional()
);

export const addToCartSchema = z.object({
    foodId: z.string().uuid("Invalid food ID").nullable().optional(),
    offerId: z.string().uuid("Invalid offer ID").nullable().optional(),
    quantity: z.coerce.number().int().min(1).nullable().optional().default(1),
    weight: optionalWeightSchema,
    variations: z.array(z.any()).nullable().optional(),
    addons: z.array(z.any()).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    branchId: z.string().uuid("Invalid branch ID").nullable().optional(),
    addressId: z.string().uuid("Invalid address ID").nullable().optional(),
    serviceModule: z.enum(["takeaway", "dine_in", "delivery"]).nullable().optional(),
    phone: optionalEgyptPhoneSchema,
    alternatePhone: optionalEgyptPhoneSchema,
    alternativePhone: optionalEgyptPhoneSchema,
});

export const updateCartItemSchema = z.object({
    quantity: z.coerce.number().int().min(1).nullable().optional(),
    weight: optionalWeightSchema,
    variations: z.array(z.any()).nullable().optional(),
    addons: z.array(z.any()).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    branchId: z.string().uuid("Invalid branch ID").nullable().optional(),
    addressId: z.string().uuid("Invalid address ID").nullable().optional(),
    serviceModule: z.enum(["takeaway", "dine_in", "delivery"]).nullable().optional(),
    phone: optionalEgyptPhoneSchema,
    alternatePhone: optionalEgyptPhoneSchema,
    alternativePhone: optionalEgyptPhoneSchema,
});
