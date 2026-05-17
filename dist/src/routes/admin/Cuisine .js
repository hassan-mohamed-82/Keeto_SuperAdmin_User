"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const Cuisine_1 = require("../../controllers/admin/Cuisine ");
const middlewares_1 = require("../../middlewares/");
const router = (0, express_1.Router)();
router.post("/", 
// validate(createCuisineSchema), 
(0, middlewares_1.hasPermission)("cuisines", "Add"), (0, catchAsync_1.catchAsync)(Cuisine_1.createCuisine));
router.get("/", (0, middlewares_1.hasPermission)("cuisines", "View"), (0, catchAsync_1.catchAsync)(Cuisine_1.getAllCuisines));
router.get("/:id", (0, middlewares_1.hasPermission)("cuisines", "View"), (0, catchAsync_1.catchAsync)(Cuisine_1.getCuisineById));
router.put("/:id", 
// validate(updateCuisineSchema), 
(0, middlewares_1.hasPermission)("cuisines", "Edit"), (0, catchAsync_1.catchAsync)(Cuisine_1.updateCuisine));
router.delete("/:id", (0, middlewares_1.hasPermission)("cuisines", "Delete"), (0, catchAsync_1.catchAsync)(Cuisine_1.deleteCuisine));
exports.default = router;
