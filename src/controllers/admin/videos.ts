import { Request, Response } from "express";
import { and, count, desc, eq, like, or } from "drizzle-orm";
import path from "path";
import fs from "fs/promises";
import { db } from "../../models/connection";
import { videos } from "../../models/schema";
import { BadRequest, NotFound } from "../../Errors";
import { SuccessResponse } from "../../utils/response";
import {
    createVideoSchema,
    getVideosQuerySchema,
    updateVideoSchema,
    updateVideoStatusSchema,
    videoIdParamSchema,
} from "../../validation/admin/videos";
import { v4 as uuidv4 } from "uuid";

const removeLocalFile = async (fileUrl: string | null | undefined) => {
    if (!fileUrl) return;
    if (fileUrl.includes("/uploads/videos/")) {
        const filename = fileUrl.split("/uploads/videos/")[1];
        if (filename) {
            const filePath = path.join(process.cwd(), "uploads", "videos", filename);
            try {
                await fs.unlink(filePath);
            } catch (err: any) {
                if (err.code !== "ENOENT") {
                    console.error("Failed to delete local video file:", err);
                }
            }
        }
    }
};

const extractFileUrls = (req: Request) => {
    let videoUrl: string | undefined = undefined;
    let thumbnailUrl: string | undefined = undefined;

    // Single file upload (e.g. uploadVideo.single("video"))
    if (req.file) {
        videoUrl = `${req.protocol}://${req.get("host")}/uploads/videos/${req.file.filename}`;
    }

    // Multiple fields upload (e.g. uploadVideo.fields([{ name: "video" }, { name: "thumbnail" }]))
    if (req.files) {
        if (!Array.isArray(req.files)) {
            const videoFile = req.files["video"]?.[0];
            const thumbFile = req.files["thumbnail"]?.[0];

            if (videoFile) {
                videoUrl = `${req.protocol}://${req.get("host")}/uploads/videos/${videoFile.filename}`;
            }
            if (thumbFile) {
                thumbnailUrl = `${req.protocol}://${req.get("host")}/uploads/videos/${thumbFile.filename}`;
            }
        }
    }

    return { videoUrl, thumbnailUrl };
};

// ─── Create Video ───
export const createVideo = async (req: Request, res: Response) => {
    const body = createVideoSchema.parse(req.body);
    const { videoUrl: uploadedVideoUrl, thumbnailUrl: uploadedThumbUrl } = extractFileUrls(req);

    const finalVideoUrl = uploadedVideoUrl || body.videoUrl;
    const finalThumbUrl = uploadedThumbUrl || body.thumbnailUrl || null;

    if (!finalVideoUrl) {
        throw new BadRequest("Video file or videoUrl is required");
    }

    const id = uuidv4();

    await db.insert(videos).values({
        id,
        title: body.title,
        titleAr: body.titleAr,
        description: body.description ?? null,
        descriptionAr: body.descriptionAr ?? null,
        videoUrl: finalVideoUrl,
        thumbnailUrl: finalThumbUrl,
        status: body.status ?? "active",
    });

    const [newVideo] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, id))
        .limit(1);

    return SuccessResponse(res, {
        message: "Video created successfully",
        data: newVideo,
    }, 201);
};

// ─── Get All Videos (Paginated + Filter) ───
export const getVideos = async (req: Request, res: Response) => {
    const { search, status, page, limit } = getVideosQuerySchema.parse(req.query);
    const offset = (page - 1) * limit;

    const filters = [];

    if (status && status !== "all") {
        filters.push(eq(videos.status, status));
    }

    if (search) {
        const pattern = `%${search}%`;
        filters.push(
            or(
                like(videos.title, pattern),
                like(videos.titleAr, pattern),
                like(videos.description, pattern),
                like(videos.descriptionAr, pattern)
            )!
        );
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const [rows, totalRows] = await Promise.all([
        db
            .select()
            .from(videos)
            .where(whereClause)
            .orderBy(desc(videos.createdAt))
            .limit(limit)
            .offset(offset),
        db
            .select({ total: count() })
            .from(videos)
            .where(whereClause),
    ]);

    const totalItems = Number(totalRows[0]?.total ?? 0);

    return SuccessResponse(res, {
        data: rows,
        pagination: {
            page,
            limit,
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
        },
    });
};

// ─── Get Video By ID ───
export const getVideoById = async (req: Request, res: Response) => {
    const { id } = videoIdParamSchema.parse(req.params);

    const [video] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, id))
        .limit(1);

    if (!video) {
        throw new NotFound("Video not found");
    }

    return SuccessResponse(res, { data: video });
};

// ─── Update Video ───
export const updateVideo = async (req: Request, res: Response) => {
    const { id } = videoIdParamSchema.parse(req.params);
    const body = updateVideoSchema.parse(req.body);

    const [existing] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, id))
        .limit(1);

    if (!existing) {
        throw new NotFound("Video not found");
    }

    const { videoUrl: uploadedVideoUrl, thumbnailUrl: uploadedThumbUrl } = extractFileUrls(req);

    // If a new video file was uploaded or provided, remove the old one if it was local
    let finalVideoUrl = existing.videoUrl;
    if (uploadedVideoUrl) {
        await removeLocalFile(existing.videoUrl);
        finalVideoUrl = uploadedVideoUrl;
    } else if (body.videoUrl !== undefined) {
        if (body.videoUrl !== existing.videoUrl) {
            await removeLocalFile(existing.videoUrl);
        }
        finalVideoUrl = body.videoUrl;
    }

    let finalThumbUrl = existing.thumbnailUrl;
    if (uploadedThumbUrl) {
        await removeLocalFile(existing.thumbnailUrl);
        finalThumbUrl = uploadedThumbUrl;
    } else if (body.thumbnailUrl !== undefined) {
        if (body.thumbnailUrl !== existing.thumbnailUrl) {
            await removeLocalFile(existing.thumbnailUrl);
        }
        finalThumbUrl = body.thumbnailUrl;
    }

    const updateData: Partial<typeof videos.$inferInsert> = {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.titleAr !== undefined && { titleAr: body.titleAr }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.descriptionAr !== undefined && { descriptionAr: body.descriptionAr }),
        ...(body.status !== undefined && { status: body.status }),
        videoUrl: finalVideoUrl,
        thumbnailUrl: finalThumbUrl,
        updatedAt: new Date(),
    };

    await db
        .update(videos)
        .set(updateData)
        .where(eq(videos.id, id));

    const [updated] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, id))
        .limit(1);

    return SuccessResponse(res, {
        message: "Video updated successfully",
        data: updated,
    });
};

// ─── Delete Video ───
export const deleteVideo = async (req: Request, res: Response) => {
    const { id } = videoIdParamSchema.parse(req.params);

    const [existing] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, id))
        .limit(1);

    if (!existing) {
        throw new NotFound("Video not found");
    }

    // Clean up local files
    await removeLocalFile(existing.videoUrl);
    await removeLocalFile(existing.thumbnailUrl);

    await db.delete(videos).where(eq(videos.id, id));

    return SuccessResponse(res, {
        message: "Video deleted successfully",
    });
};

// ─── Update Video Status ───
export const updateVideoStatus = async (req: Request, res: Response) => {
    const { id } = videoIdParamSchema.parse(req.params);
    const { status } = updateVideoStatusSchema.parse(req.body);

    const [existing] = await db
        .select()
        .from(videos)
        .where(eq(videos.id, id))
        .limit(1);

    if (!existing) {
        throw new NotFound("Video not found");
    }

    await db
        .update(videos)
        .set({ status, updatedAt: new Date() })
        .where(eq(videos.id, id));

    return SuccessResponse(res, {
        message: `Video status updated to ${status} successfully`,
        data: { id, status },
    });
};
