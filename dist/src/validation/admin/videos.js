"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVideosQuerySchema = exports.videoIdParamSchema = exports.updateVideoStatusSchema = exports.updateVideoSchema = exports.createVideoSchema = void 0;
const zod_1 = require("zod");
exports.createVideoSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1, "Title in English is required").max(255),
    titleAr: zod_1.z.string().trim().min(1, "Title in Arabic is required").max(255),
    description: zod_1.z.string().trim().max(5000).optional().nullable(),
    descriptionAr: zod_1.z.string().trim().max(5000).optional().nullable(),
    videoUrl: zod_1.z.string().trim().max(1000).optional(),
    videoUrlAr: zod_1.z.string().trim().max(1000).optional().nullable(),
    thumbnailUrl: zod_1.z.string().trim().max(1000).optional().nullable(),
    thumbnailUrlAr: zod_1.z.string().trim().max(1000).optional().nullable(),
    status: zod_1.z.enum(["active", "inactive"]).optional().default("active"),
});
exports.updateVideoSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(255).optional(),
    titleAr: zod_1.z.string().trim().min(1).max(255).optional(),
    description: zod_1.z.string().trim().max(5000).optional().nullable(),
    descriptionAr: zod_1.z.string().trim().max(5000).optional().nullable(),
    videoUrl: zod_1.z.string().trim().max(1000).optional(),
    videoUrlAr: zod_1.z.string().trim().max(1000).optional().nullable(),
    thumbnailUrl: zod_1.z.string().trim().max(1000).optional().nullable(),
    thumbnailUrlAr: zod_1.z.string().trim().max(1000).optional().nullable(),
    status: zod_1.z.enum(["active", "inactive"]).optional(),
});
exports.updateVideoStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["active", "inactive"]),
});
exports.videoIdParamSchema = zod_1.z.object({
    id: zod_1.z.string().uuid("Invalid video ID"),
});
exports.getVideosQuerySchema = zod_1.z.object({
    search: zod_1.z.string().trim().optional(),
    status: zod_1.z.enum(["active", "inactive", "all"]).optional().default("all"),
    page: zod_1.z.coerce.number().int().min(1).default(1),
    limit: zod_1.z.coerce.number().int().min(1).max(100).default(20),
});
