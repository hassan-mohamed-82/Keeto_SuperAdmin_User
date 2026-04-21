"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const home_1 = require("../../controllers/user/home");
const catchAsync_1 = require("../../utils/catchAsync");
const router = (0, express_1.Router)();
router.post("/toggle", (0, catchAsync_1.catchAsync)(home_1.toggleFavorite));
router.get("/", (0, catchAsync_1.catchAsync)(home_1.getUserFavorites));
exports.default = router;
