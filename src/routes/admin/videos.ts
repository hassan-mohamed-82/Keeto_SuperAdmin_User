import { Router } from "express";
import {
    createVideo,
    deleteVideo,
    getVideoById,
    getVideos,
    updateVideo,
    updateVideoStatus,
} from "../../controllers/admin/videos";
import { validate } from "../../middlewares/validation";
import { uploadVideo } from "../../middlewares/multer";
import { catchAsync } from "../../utils/catchAsync";
import { hasPermission } from "../../middlewares";
import {
    createVideoSchema,
    getVideosQuerySchema,
    updateVideoSchema,
    updateVideoStatusSchema,
    videoIdParamSchema,
} from "../../validation/admin/videos";

const router = Router();

const videoUploadFields = uploadVideo.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
]);

router.post(
    "/",
    hasPermission("Videos", "Add"),
    videoUploadFields,
    validate(createVideoSchema),
    catchAsync(createVideo)
);

router.get(
    "/",
    hasPermission("Videos", "View"),
    validate(getVideosQuerySchema, "query"),
    catchAsync(getVideos)
);

router.get(
    "/:id",
    hasPermission("Videos", "View"),
    validate(videoIdParamSchema, "params"),
    catchAsync(getVideoById)
);

router.put(
    "/:id",
    hasPermission("Videos", "Edit"),
    videoUploadFields,
    validate(videoIdParamSchema, "params"),
    validate(updateVideoSchema),
    catchAsync(updateVideo)
);

router.put(
    "/:id/status",
    hasPermission("Videos", "Edit"),
    validate(videoIdParamSchema, "params"),
    validate(updateVideoStatusSchema),
    catchAsync(updateVideoStatus)
);

router.delete(
    "/:id",
    hasPermission("Videos", "Delete"),
    validate(videoIdParamSchema, "params"),
    catchAsync(deleteVideo)
);

export default router;
