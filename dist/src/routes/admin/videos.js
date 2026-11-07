"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const videos_1 = require("../../controllers/admin/videos");
const validation_1 = require("../../middlewares/validation");
const multer_1 = require("../../middlewares/multer");
const catchAsync_1 = require("../../utils/catchAsync");
const middlewares_1 = require("../../middlewares");
const videos_2 = require("../../validation/admin/videos");
const router = (0, express_1.Router)();
const videoUploadFields = multer_1.uploadVideo.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
]);
router.post("/", (0, middlewares_1.hasPermission)("Videos", "Add"), videoUploadFields, (0, validation_1.validate)(videos_2.createVideoSchema), (0, catchAsync_1.catchAsync)(videos_1.createVideo));
router.get("/", (0, middlewares_1.hasPermission)("Videos", "View"), (0, validation_1.validate)(videos_2.getVideosQuerySchema, "query"), (0, catchAsync_1.catchAsync)(videos_1.getVideos));
router.get("/:id", (0, middlewares_1.hasPermission)("Videos", "View"), (0, validation_1.validate)(videos_2.videoIdParamSchema, "params"), (0, catchAsync_1.catchAsync)(videos_1.getVideoById));
router.put("/:id", (0, middlewares_1.hasPermission)("Videos", "Edit"), videoUploadFields, (0, validation_1.validate)(videos_2.videoIdParamSchema, "params"), (0, validation_1.validate)(videos_2.updateVideoSchema), (0, catchAsync_1.catchAsync)(videos_1.updateVideo));
router.put("/:id/status", (0, middlewares_1.hasPermission)("Videos", "Edit"), (0, validation_1.validate)(videos_2.videoIdParamSchema, "params"), (0, validation_1.validate)(videos_2.updateVideoStatusSchema), (0, catchAsync_1.catchAsync)(videos_1.updateVideoStatus));
router.delete("/:id", (0, middlewares_1.hasPermission)("Videos", "Delete"), (0, validation_1.validate)(videos_2.videoIdParamSchema, "params"), (0, catchAsync_1.catchAsync)(videos_1.deleteVideo));
exports.default = router;
