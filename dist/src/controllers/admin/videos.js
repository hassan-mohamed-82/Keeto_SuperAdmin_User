"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateVideoStatus = exports.deleteVideo = exports.updateVideo = exports.getVideoById = exports.getVideos = exports.createVideo = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const Errors_1 = require("../../Errors");
const response_1 = require("../../utils/response");
const videos_1 = require("../../validation/admin/videos");
const uuid_1 = require("uuid");
const removeLocalFile = async (fileUrl) => {
    if (!fileUrl)
        return;
    if (fileUrl.includes("/uploads/videos/")) {
        const filename = fileUrl.split("/uploads/videos/")[1];
        if (filename) {
            const filePath = path_1.default.join(process.cwd(), "uploads", "videos", filename);
            try {
                await promises_1.default.unlink(filePath);
            }
            catch (err) {
                if (err.code !== "ENOENT") {
                    console.error("Failed to delete local video file:", err);
                }
            }
        }
    }
};
const extractFileUrls = (req) => {
    let videoUrl = undefined;
    let videoUrlAr = undefined;
    let thumbnailUrl = undefined;
    let thumbnailUrlAr = undefined;
    // Single file upload (e.g. uploadVideo.single("video"))
    if (req.file) {
        videoUrl = `${req.protocol}://${req.get("host")}/uploads/videos/${req.file.filename}`;
    }
    // Multiple fields upload (e.g. uploadVideo.fields([...]))
    if (req.files) {
        if (!Array.isArray(req.files)) {
            const videoFile = req.files["video"]?.[0];
            const videoArFile = req.files["videoAr"]?.[0];
            const thumbFile = req.files["thumbnail"]?.[0];
            const thumbArFile = req.files["thumbnailAr"]?.[0];
            if (videoFile) {
                videoUrl = `${req.protocol}://${req.get("host")}/uploads/videos/${videoFile.filename}`;
            }
            if (videoArFile) {
                videoUrlAr = `${req.protocol}://${req.get("host")}/uploads/videos/${videoArFile.filename}`;
            }
            if (thumbFile) {
                thumbnailUrl = `${req.protocol}://${req.get("host")}/uploads/videos/${thumbFile.filename}`;
            }
            if (thumbArFile) {
                thumbnailUrlAr = `${req.protocol}://${req.get("host")}/uploads/videos/${thumbArFile.filename}`;
            }
        }
    }
    return { videoUrl, videoUrlAr, thumbnailUrl, thumbnailUrlAr };
};
// ─── Create Video ───
const createVideo = async (req, res) => {
    const body = videos_1.createVideoSchema.parse(req.body);
    const { videoUrl: uploadedVideoUrl, videoUrlAr: uploadedVideoUrlAr, thumbnailUrl: uploadedThumbUrl, thumbnailUrlAr: uploadedThumbUrlAr } = extractFileUrls(req);
    const finalVideoUrl = uploadedVideoUrl || body.videoUrl;
    const finalVideoUrlAr = uploadedVideoUrlAr || body.videoUrlAr || null;
    const finalThumbUrl = uploadedThumbUrl || body.thumbnailUrl || null;
    const finalThumbUrlAr = uploadedThumbUrlAr || body.thumbnailUrlAr || null;
    if (!finalVideoUrl) {
        throw new Errors_1.BadRequest("Video file or videoUrl is required");
    }
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.videos).values({
        id,
        title: body.title,
        titleAr: body.titleAr,
        description: body.description ?? null,
        descriptionAr: body.descriptionAr ?? null,
        videoUrl: finalVideoUrl,
        videoUrlAr: finalVideoUrlAr,
        thumbnailUrl: finalThumbUrl,
        thumbnailUrlAr: finalThumbUrlAr,
        status: body.status ?? "active",
    });
    const [newVideo] = await connection_1.db
        .select()
        .from(schema_1.videos)
        .where((0, drizzle_orm_1.eq)(schema_1.videos.id, id))
        .limit(1);
    return (0, response_1.SuccessResponse)(res, {
        message: "Video created successfully",
        data: newVideo,
    }, 201);
};
exports.createVideo = createVideo;
// ─── Get All Videos (Paginated + Filter) ───
const getVideos = async (req, res) => {
    const { search, status, page, limit } = videos_1.getVideosQuerySchema.parse(req.query);
    const offset = (page - 1) * limit;
    const filters = [];
    if (status && status !== "all") {
        filters.push((0, drizzle_orm_1.eq)(schema_1.videos.status, status));
    }
    if (search) {
        const pattern = `%${search}%`;
        filters.push((0, drizzle_orm_1.or)((0, drizzle_orm_1.like)(schema_1.videos.title, pattern), (0, drizzle_orm_1.like)(schema_1.videos.titleAr, pattern), (0, drizzle_orm_1.like)(schema_1.videos.description, pattern), (0, drizzle_orm_1.like)(schema_1.videos.descriptionAr, pattern)));
    }
    const whereClause = filters.length > 0 ? (0, drizzle_orm_1.and)(...filters) : undefined;
    const [rows, totalRows] = await Promise.all([
        connection_1.db
            .select()
            .from(schema_1.videos)
            .where(whereClause)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.videos.createdAt))
            .limit(limit)
            .offset(offset),
        connection_1.db
            .select({ total: (0, drizzle_orm_1.count)() })
            .from(schema_1.videos)
            .where(whereClause),
    ]);
    const totalItems = Number(totalRows[0]?.total ?? 0);
    return (0, response_1.SuccessResponse)(res, {
        data: rows,
        pagination: {
            page,
            limit,
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
        },
    });
};
exports.getVideos = getVideos;
// ─── Get Video By ID ───
const getVideoById = async (req, res) => {
    const { id } = videos_1.videoIdParamSchema.parse(req.params);
    const [video] = await connection_1.db
        .select()
        .from(schema_1.videos)
        .where((0, drizzle_orm_1.eq)(schema_1.videos.id, id))
        .limit(1);
    if (!video) {
        throw new Errors_1.NotFound("Video not found");
    }
    return (0, response_1.SuccessResponse)(res, { data: video });
};
exports.getVideoById = getVideoById;
// ─── Update Video ───
const updateVideo = async (req, res) => {
    const { id } = videos_1.videoIdParamSchema.parse(req.params);
    const body = videos_1.updateVideoSchema.parse(req.body);
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.videos)
        .where((0, drizzle_orm_1.eq)(schema_1.videos.id, id))
        .limit(1);
    if (!existing) {
        throw new Errors_1.NotFound("Video not found");
    }
    const { videoUrl: uploadedVideoUrl, videoUrlAr: uploadedVideoUrlAr, thumbnailUrl: uploadedThumbUrl, thumbnailUrlAr: uploadedThumbUrlAr } = extractFileUrls(req);
    // ── videoUrl (EN) ──
    let finalVideoUrl = existing.videoUrl;
    if (uploadedVideoUrl) {
        await removeLocalFile(existing.videoUrl);
        finalVideoUrl = uploadedVideoUrl;
    }
    else if (body.videoUrl !== undefined) {
        if (body.videoUrl !== existing.videoUrl) {
            await removeLocalFile(existing.videoUrl);
        }
        finalVideoUrl = body.videoUrl;
    }
    // ── videoUrlAr (AR) ──
    let finalVideoUrlAr = existing.videoUrlAr;
    if (uploadedVideoUrlAr) {
        await removeLocalFile(existing.videoUrlAr);
        finalVideoUrlAr = uploadedVideoUrlAr;
    }
    else if (body.videoUrlAr !== undefined) {
        if (body.videoUrlAr !== existing.videoUrlAr) {
            await removeLocalFile(existing.videoUrlAr);
        }
        finalVideoUrlAr = body.videoUrlAr;
    }
    // ── thumbnailUrl (EN) ──
    let finalThumbUrl = existing.thumbnailUrl;
    if (uploadedThumbUrl) {
        await removeLocalFile(existing.thumbnailUrl);
        finalThumbUrl = uploadedThumbUrl;
    }
    else if (body.thumbnailUrl !== undefined) {
        if (body.thumbnailUrl !== existing.thumbnailUrl) {
            await removeLocalFile(existing.thumbnailUrl);
        }
        finalThumbUrl = body.thumbnailUrl;
    }
    // ── thumbnailUrlAr (AR) ──
    let finalThumbUrlAr = existing.thumbnailUrlAr;
    if (uploadedThumbUrlAr) {
        await removeLocalFile(existing.thumbnailUrlAr);
        finalThumbUrlAr = uploadedThumbUrlAr;
    }
    else if (body.thumbnailUrlAr !== undefined) {
        if (body.thumbnailUrlAr !== existing.thumbnailUrlAr) {
            await removeLocalFile(existing.thumbnailUrlAr);
        }
        finalThumbUrlAr = body.thumbnailUrlAr;
    }
    const updateData = {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.titleAr !== undefined && { titleAr: body.titleAr }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.descriptionAr !== undefined && { descriptionAr: body.descriptionAr }),
        ...(body.status !== undefined && { status: body.status }),
        videoUrl: finalVideoUrl,
        videoUrlAr: finalVideoUrlAr,
        thumbnailUrl: finalThumbUrl,
        thumbnailUrlAr: finalThumbUrlAr,
        updatedAt: new Date(),
    };
    await connection_1.db
        .update(schema_1.videos)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.videos.id, id));
    const [updated] = await connection_1.db
        .select()
        .from(schema_1.videos)
        .where((0, drizzle_orm_1.eq)(schema_1.videos.id, id))
        .limit(1);
    return (0, response_1.SuccessResponse)(res, {
        message: "Video updated successfully",
        data: updated,
    });
};
exports.updateVideo = updateVideo;
// ─── Delete Video ───
const deleteVideo = async (req, res) => {
    const { id } = videos_1.videoIdParamSchema.parse(req.params);
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.videos)
        .where((0, drizzle_orm_1.eq)(schema_1.videos.id, id))
        .limit(1);
    if (!existing) {
        throw new Errors_1.NotFound("Video not found");
    }
    // Clean up local files
    await removeLocalFile(existing.videoUrl);
    await removeLocalFile(existing.thumbnailUrl);
    await connection_1.db.delete(schema_1.videos).where((0, drizzle_orm_1.eq)(schema_1.videos.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "Video deleted successfully",
    });
};
exports.deleteVideo = deleteVideo;
// ─── Update Video Status ───
const updateVideoStatus = async (req, res) => {
    const { id } = videos_1.videoIdParamSchema.parse(req.params);
    const { status } = videos_1.updateVideoStatusSchema.parse(req.body);
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.videos)
        .where((0, drizzle_orm_1.eq)(schema_1.videos.id, id))
        .limit(1);
    if (!existing) {
        throw new Errors_1.NotFound("Video not found");
    }
    await connection_1.db
        .update(schema_1.videos)
        .set({ status, updatedAt: new Date() })
        .where((0, drizzle_orm_1.eq)(schema_1.videos.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: `Video status updated to ${status} successfully`,
        data: { id, status },
    });
};
exports.updateVideoStatus = updateVideoStatus;
