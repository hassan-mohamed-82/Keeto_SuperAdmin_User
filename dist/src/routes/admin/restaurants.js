"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const restaurants_1 = require("../../controllers/admin/restaurants");
const middlewares_1 = require("../../middlewares/");
const router = (0, express_1.Router)();
router.get("/select", (0, catchAsync_1.catchAsync)(restaurants_1.getallcousinesandzones));
router.post("/", (0, middlewares_1.hasPermission)("Restaurants", "Add"), 
// validate(createRestaurantSchema),
(0, catchAsync_1.catchAsync)(restaurants_1.createRestaurant));
router.get("/", (0, middlewares_1.hasPermission)("Restaurants", "View"), (0, catchAsync_1.catchAsync)(restaurants_1.getAllRestaurants));
router.get("/:id", (0, middlewares_1.hasPermission)("Restaurants", "View"), (0, catchAsync_1.catchAsync)(restaurants_1.getRestaurantById));
router.put("/:id", (0, middlewares_1.hasPermission)("Restaurants", "Edit"), 
//  validate(updateRestaurantSchema), 
(0, catchAsync_1.catchAsync)(restaurants_1.updateRestaurant));
router.delete("/:id", (0, middlewares_1.hasPermission)("Restaurants", "Delete"), (0, catchAsync_1.catchAsync)(restaurants_1.deleteRestaurant));
exports.default = router;
