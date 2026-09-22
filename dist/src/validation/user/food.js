"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFoodByIdQuerySchema = exports.getFoodByIdParamsSchema = void 0;
const zod_1 = require("zod");
// ==========================================
// User Food / Product Validation Schemas
// ==========================================
exports.getFoodByIdParamsSchema = zod_1.z.object({
    id: zod_1.z.string().uuid("Product ID must be a valid UUID"),
});
exports.getFoodByIdQuerySchema = zod_1.z.object({
    branchId: zod_1.z.string().uuid("branchId must be a valid UUID").optional(),
    addressId: zod_1.z.string().uuid("addressId must be a valid UUID").optional(),
    serviceModule: zod_1.z.enum(["delivery", "takeaway", "dine_in"]).optional(),
});
