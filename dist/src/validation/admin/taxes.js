"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateKeetoTaxSchema = exports.createKeetoTaxSchema = exports.TAX_PLATFORM_TYPES = exports.TAX_MODULE_TYPES = exports.TAX_AMOUNT_TYPES = void 0;
const zod_1 = require("zod");
exports.TAX_AMOUNT_TYPES = ["percentage", "value"];
exports.TAX_MODULE_TYPES = ["pos", "online", "all"]; // stored in `modules`
exports.TAX_PLATFORM_TYPES = ["web", "app", "all"]; // stored in `moduleType`
const numeric = zod_1.z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), zod_1.z.number({ required_error: "Amount is required", invalid_type_error: "Amount must be numeric" })
    .min(0, "Amount must be 0 or greater"));
const refineAmount = (d) => !(d.amountType === "percentage" && d.amount !== undefined && d.amount > 100);
/**
 * Keeto tax (super admin). source = "keeto", always "exclude" → added to the order total.
 * restaurantIds omitted / [] → applies to ALL restaurants, otherwise only to the selected ones.
 */
const restaurantIdsSchema = zod_1.z.array(zod_1.z.string().min(1, "Restaurant ID cannot be empty"), {
    invalid_type_error: "restaurantIds must be an array of restaurant IDs",
});
exports.createKeetoTaxSchema = zod_1.z
    .object({
    restaurantIds: restaurantIdsSchema.default([]),
    name: zod_1.z.string({ required_error: "Name is required" }).min(1).max(255),
    nameAr: zod_1.z.string().max(255).optional().nullable(),
    nameFr: zod_1.z.string().max(255).optional().nullable(),
    amount: numeric,
    amountType: zod_1.z.enum(exports.TAX_AMOUNT_TYPES).default("percentage"),
    modules: zod_1.z.enum(exports.TAX_MODULE_TYPES).default("all"),
    moduleType: zod_1.z.enum(exports.TAX_PLATFORM_TYPES).default("all"),
    status: zod_1.z.enum(["active", "inactive"]).default("active"),
})
    .refine(refineAmount, { message: "Percentage amount cannot exceed 100", path: ["amount"] });
exports.updateKeetoTaxSchema = zod_1.z
    .object({
    restaurantIds: restaurantIdsSchema.optional(),
    name: zod_1.z.string().min(1).max(255).optional(),
    nameAr: zod_1.z.string().max(255).optional().nullable(),
    nameFr: zod_1.z.string().max(255).optional().nullable(),
    amount: numeric.optional(),
    amountType: zod_1.z.enum(exports.TAX_AMOUNT_TYPES).optional(),
    modules: zod_1.z.enum(exports.TAX_MODULE_TYPES).optional(),
    moduleType: zod_1.z.enum(exports.TAX_PLATFORM_TYPES).optional(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
})
    .refine(refineAmount, { message: "Percentage amount cannot exceed 100", path: ["amount"] });
