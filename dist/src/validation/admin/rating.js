"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ratingRequestIdParamSchema = exports.resolveRatingRequestSchema = exports.getAdminRatingRequestsQuerySchema = void 0;
const zod_1 = require("zod");
// ==========================================
// 1. Query Rating Requests List (SuperAdmin)
// ==========================================
exports.getAdminRatingRequestsQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(["pending", "approved", "rejected", "all"]).optional().default("all"),
    targetType: zod_1.z.enum(["restaurant", "order", "all"]).optional().default("restaurant"),
    restaurantId: zod_1.z.string().uuid("Invalid restaurant ID").optional(),
    page: zod_1.z.coerce.number().int().min(1).optional().default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).optional().default(10),
});
// ==========================================
// 2. Resolve (Approve / Reject) Rating Request
// ==========================================
exports.resolveRatingRequestSchema = zod_1.z.object({
    adminNotes: zod_1.z.string().max(1000).optional().nullable(),
});
// ==========================================
// 3. Request ID Param
// ==========================================
exports.ratingRequestIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid("Invalid request ID"),
});
