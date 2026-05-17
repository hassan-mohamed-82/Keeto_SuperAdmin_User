"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const food_1 = require("../../controllers/admin/food");
const middlewares_1 = require("../../middlewares/");
const router = (0, express_1.Router)();
router.get("/select", (0, catchAsync_1.catchAsync)(food_1.getFoodSelectData));
router.get("/restaurant/:id", (0, catchAsync_1.catchAsync)(food_1.getFoodsByRestaurantId));
router.post("/", 
//  validate(createFoodSchema),
(0, middlewares_1.hasPermission)("Food", "Add"), (0, catchAsync_1.catchAsync)(food_1.createFood));
router.get("/", (0, middlewares_1.hasPermission)("Food", "View"), (0, catchAsync_1.catchAsync)(food_1.getAllFoods));
router.get("/:id", (0, middlewares_1.hasPermission)("Food", "View"), (0, catchAsync_1.catchAsync)(food_1.getFoodById));
router.put("/:id", 
//  validate(updateFoodSchema), 
(0, middlewares_1.hasPermission)("Food", "Edit"), (0, catchAsync_1.catchAsync)(food_1.updateFood));
router.delete("/:id", (0, middlewares_1.hasPermission)("Food", "Delete"), (0, catchAsync_1.catchAsync)(food_1.deleteFood));
// Toggle Endpoints
router.put("/variation/:id/status", (0, middlewares_1.hasPermission)("Food", "Edit"), (0, catchAsync_1.catchAsync)(food_1.toggleVariationStatus));
router.put("/option/:id/status", (0, middlewares_1.hasPermission)("Food", "Edit"), (0, catchAsync_1.catchAsync)(food_1.toggleOptionStatus));
exports.default = router;
