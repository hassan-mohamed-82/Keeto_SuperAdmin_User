"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const image_1 = require("../../controllers/user/image");
const catchAsync_1 = require("../../utils/catchAsync");
const router = (0, express_1.Router)();
router.get("/:resId", (0, catchAsync_1.catchAsync)(image_1.getImages));
exports.default = router;
