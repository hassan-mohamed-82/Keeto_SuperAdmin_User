"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const SocialMedia_1 = require("../../controllers/user/SocialMedia");
const catchAsync_1 = require("../../utils/catchAsync");
const router = (0, express_1.Router)();
router.get("/:id", (0, catchAsync_1.catchAsync)(SocialMedia_1.getSocialMedia));
exports.default = router;
