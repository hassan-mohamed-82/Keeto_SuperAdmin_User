"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBundleByIdParamsSchema = exports.getAllBundlesQuerySchema = void 0;
const zod_1 = require("zod");
// ==========================================
// User Bundle Offers Validation Schemas
// ==========================================
// ------------------------------------------
// 1. GET /  — optional filters
// ------------------------------------------
exports.getAllBundlesQuerySchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("restaurantId must be a valid UUID").optional(),
    page: zod_1.z
        .union([zod_1.z.number().int().positive(), zod_1.z.string().transform((v) => parseInt(v, 10))])
        .refine((v) => !isNaN(v) && v > 0, { message: "page must be a positive integer" })
        .optional(),
    limit: zod_1.z
        .union([zod_1.z.number().int().positive(), zod_1.z.string().transform((v) => parseInt(v, 10))])
        .refine((v) => !isNaN(v) && v > 0 && v <= 100, { message: "limit must be between 1 and 100" })
        .optional(),
});
// ------------------------------------------
// 2. GET /bundles/:id
// ------------------------------------------
exports.getBundleByIdParamsSchema = zod_1.z.object({
    id: zod_1.z.string().uuid("id must be a valid UUID"),
});
