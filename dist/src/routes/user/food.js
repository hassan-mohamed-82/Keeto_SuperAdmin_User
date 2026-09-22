"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const food_1 = require("../../controllers/user/food");
const validation_1 = require("../../middlewares/validation");
const authenticated_1 = require("../../middlewares/authenticated");
const food_2 = require("../../validation/user/food");
const router = (0, express_1.Router)();
// GET /:id — Get product by ID with full details & discount details
router.get("/:id", authenticated_1.optionalAuth, (0, validation_1.validate)(food_2.getFoodByIdParamsSchema, "params"), (0, catchAsync_1.catchAsync)(food_1.getProductById));
exports.default = router;
