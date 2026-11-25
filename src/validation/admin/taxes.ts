import { z } from "zod";

export const TAX_AMOUNT_TYPES = ["percentage", "value"] as const;
export const TAX_MODULE_TYPES = ["pos", "online", "all"] as const; // stored in `modules`
export const TAX_PLATFORM_TYPES = ["web", "app", "all"] as const; // stored in `moduleType`

const numeric = z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z.number({ required_error: "Amount is required", invalid_type_error: "Amount must be numeric" })
        .min(0, "Amount must be 0 or greater")
);

const refineAmount = (d: { amountType?: string; amount?: number }) =>
    !(d.amountType === "percentage" && d.amount !== undefined && d.amount > 100);

/**
 * Keeto tax (super admin). source = "keeto", always "exclude" → added to the order total.
 * restaurantIds omitted / [] → applies to ALL restaurants, otherwise only to the selected ones.
 */
const restaurantIdsSchema = z.array(z.string().min(1, "Restaurant ID cannot be empty"), {
    invalid_type_error: "restaurantIds must be an array of restaurant IDs",
});
export const createKeetoTaxSchema = z
    .object({
        restaurantIds: restaurantIdsSchema.default([]),
        name: z.string({ required_error: "Name is required" }).min(1).max(255),
        nameAr: z.string().max(255).optional().nullable(),
        nameFr: z.string().max(255).optional().nullable(),
        amount: numeric,
        amountType: z.enum(TAX_AMOUNT_TYPES).default("percentage"),
        modules: z.enum(TAX_MODULE_TYPES).default("all"),
        moduleType: z.enum(TAX_PLATFORM_TYPES).default("all"),
        status: z.enum(["active", "inactive"]).default("active"),
    })
    .refine(refineAmount, { message: "Percentage amount cannot exceed 100", path: ["amount"] });

export const updateKeetoTaxSchema = z
    .object({
        restaurantIds: restaurantIdsSchema.optional(),
        name: z.string().min(1).max(255).optional(),
        nameAr: z.string().max(255).optional().nullable(),
        nameFr: z.string().max(255).optional().nullable(),
        amount: numeric.optional(),
        amountType: z.enum(TAX_AMOUNT_TYPES).optional(),
        modules: z.enum(TAX_MODULE_TYPES).optional(),
        moduleType: z.enum(TAX_PLATFORM_TYPES).optional(),
        status: z.enum(["active", "inactive"]).optional(),
    })
    .refine(refineAmount, { message: "Percentage amount cannot exceed 100", path: ["amount"] });
