"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const slider_1 = require("../../controllers/user/slider");
const catchAsync_1 = require("../../utils/catchAsync");
const router = (0, express_1.Router)();
router.get("/:resId", (0, catchAsync_1.catchAsync)(slider_1.getSliders));
exports.default = router;
