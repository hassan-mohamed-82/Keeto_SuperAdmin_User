"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const restaurantGroups_1 = require("../../controllers/admin/restaurantGroups");
const validation_1 = require("../../middlewares/validation");
const restaurantGroups_2 = require("../../validation/admin/restaurantGroups");
const middlewares_1 = require("../../middlewares/");
const router = (0, express_1.Router)();
// 1. Create a new restaurant group
router.post("/", (0, middlewares_1.hasPermission)("Restaurants", "Add"), (0, validation_1.validate)(restaurantGroups_2.createRestaurantGroupSchema), (0, catchAsync_1.catchAsync)(restaurantGroups_1.createRestaurantGroup));
// 2. Get all restaurant groups
router.get("/", (0, middlewares_1.hasPermission)("Restaurants", "View"), (0, catchAsync_1.catchAsync)(restaurantGroups_1.getAllRestaurantGroups));
// 3. Get restaurant group by ID
router.get("/:id", (0, middlewares_1.hasPermission)("Restaurants", "View"), (0, catchAsync_1.catchAsync)(restaurantGroups_1.getRestaurantGroupById));
// 4. Update restaurant group
router.put("/:id", (0, middlewares_1.hasPermission)("Restaurants", "Edit"), (0, validation_1.validate)(restaurantGroups_2.updateRestaurantGroupSchema), (0, catchAsync_1.catchAsync)(restaurantGroups_1.updateRestaurantGroup));
// 5. Delete restaurant group
router.delete("/:id", (0, middlewares_1.hasPermission)("Restaurants", "Delete"), (0, catchAsync_1.catchAsync)(restaurantGroups_1.deleteRestaurantGroup));
// 6. Toggle active/inactive status
router.put("/:id/toggle-status", (0, middlewares_1.hasPermission)("Restaurants", "Status"), (0, catchAsync_1.catchAsync)(restaurantGroups_1.toggleRestaurantGroupStatus));
exports.default = router;
