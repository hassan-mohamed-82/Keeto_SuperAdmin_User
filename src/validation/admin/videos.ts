import { z } from "zod";

export const createVideoSchema = z.object({
    title: z.string().trim().min(1, "Title in English is required").max(255),
    titleAr: z.string().trim().min(1, "Title in Arabic is required").max(255),
    description: z.string().trim().max(5000).optional().nullable(),
    descriptionAr: z.string().trim().max(5000).optional().nullable(),
    videoUrl: z.string().trim().max(1000).optional(),
    thumbnailUrl: z.string().trim().max(1000).optional().nullable(),
    status: z.enum(["active", "inactive"]).optional().default("active"),
});

export const updateVideoSchema = z.object({
    title: z.string().trim().min(1).max(255).optional(),
    titleAr: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).optional().nullable(),
    descriptionAr: z.string().trim().max(5000).optional().nullable(),
    videoUrl: z.string().trim().max(1000).optional(),
    thumbnailUrl: z.string().trim().max(1000).optional().nullable(),
    status: z.enum(["active", "inactive"]).optional(),
});

export const updateVideoStatusSchema = z.object({
    status: z.enum(["active", "inactive"]),
});

export const videoIdParamSchema = z.object({
    id: z.string().uuid("Invalid video ID"),
});

export const getVideosQuerySchema = z.object({
    search: z.string().trim().optional(),
    status: z.enum(["active", "inactive", "all"]).optional().default("all"),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateVideoInput = z.infer<typeof createVideoSchema>;
export type UpdateVideoInput = z.infer<typeof updateVideoSchema>;
export type UpdateVideoStatusInput = z.infer<typeof updateVideoStatusSchema>;
export type GetVideosQueryInput = z.infer<typeof getVideosQuerySchema>;
