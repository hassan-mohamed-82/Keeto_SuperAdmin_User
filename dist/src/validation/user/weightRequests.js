"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWeightRequestParamSchema = exports.cancelWeightRequestSchema = exports.sendWeightRequestSchema = void 0;
const zod_1 = require("zod");
exports.sendWeightRequestSchema = zod_1.z.object({
    restaurantId: zod_1.z.string().uuid("Invalid restaurant ID").optional(),
});
exports.cancelWeightRequestSchema = zod_1.z.object({
    reason: zod_1.z.string().max(500, "Reason cannot exceed 500 characters").optional(),
});
exports.getWeightRequestParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid("Invalid weight request ID"),
});
