"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRestaurantDiscountsParamsSchema = exports.getRestaurantOffersParamsSchema = exports.getDiscountsWithProductsQuerySchema = void 0;
const zod_1 = require("zod");
// ==========================================
// User Offers & Discounts Validation Schemas
// ==========================================
exports.getDiscountsWithProductsQuerySchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("restaurantId must be a valid UUID").optional(),
    branchId: zod_1.z.string().uuid("branchId must be a valid UUID").optional(),
    addressId: zod_1.z.string().uuid("addressId must be a valid UUID").optional(),
    serviceModule: zod_1.z.enum(["delivery", "takeaway", "dine_in"]).optional(),
});
exports.getRestaurantOffersParamsSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("restaurantId must be a valid UUID"),
});
exports.getRestaurantDiscountsParamsSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("restaurantId must be a valid UUID"),
});
