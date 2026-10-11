"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkFirstOrderDiscountQuerySchema = void 0;
const zod_1 = require("zod");
exports.checkFirstOrderDiscountQuerySchema = zod_1.z.object({
    restaurantId: zod_1.z.string().min(1, "restaurantId is required"),
    subtotal: zod_1.z.coerce.number().min(0).optional(),
});
