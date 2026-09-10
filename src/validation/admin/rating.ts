import { z } from "zod";

// ==========================================
// 1. Query Rating Requests List (SuperAdmin)
// ==========================================
export const getAdminRatingRequestsQuerySchema = z.object({
    status: z.enum(["pending", "approved", "rejected", "all"]).optional().default("all"),
    targetType: z.enum(["restaurant", "order", "all"]).optional().default("restaurant"),
    restaurantId: z.string().uuid("Invalid restaurant ID").optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
});

// ==========================================
// 2. Resolve (Approve / Reject) Rating Request
// ==========================================
export const resolveRatingRequestSchema = z.object({
    adminNotes: z.string().max(1000).optional().nullable(),
});

// ==========================================
// 3. Request ID Param
// ==========================================
export const ratingRequestIdParamSchema = z.object({
    id: z.string().uuid("Invalid request ID"),
});

export type GetAdminRatingRequestsQueryInput = z.infer<typeof getAdminRatingRequestsQuerySchema>;
export type ResolveRatingRequestInput = z.infer<typeof resolveRatingRequestSchema>;