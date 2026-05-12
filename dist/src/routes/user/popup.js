"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const popup_1 = require("../../controllers/user/popup");
const catchAsync_1 = require("../../utils/catchAsync");
const router = (0, express_1.Router)();
router.get("/", (0, catchAsync_1.catchAsync)(popup_1.getActivePopups));
router.get("/:id", (0, catchAsync_1.catchAsync)(popup_1.getPopupById));
exports.default = router;
