"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catchAsync_1 = require("../../utils/catchAsync");
const restaurants_1 = require("../../controllers/admin/restaurants");
const validation_1 = require("../../middlewares/validation");
const middlewares_1 = require("../../middlewares/");
const restaurantDomains_1 = require("../../controllers/admin/restaurantDomains");
const restaurantDomains_2 = require("../../validation/admin/restaurantDomains");
const router = (0, express_1.Router)();
router.get("/select", (0, catchAsync_1.catchAsync)(restaurants_1.getallcousinesandzones));
router.get("/select-data", (0, catchAsync_1.catchAsync)(restaurants_1.getRestaurantSelectData));
router.get("/sales/active", (0, catchAsync_1.catchAsync)(restaurants_1.getActiveSales));
router.post("/", (0, middlewares_1.hasPermission)("Restaurants", "Add"), 
// validate(createRestaurantSchema),
(0, catchAsync_1.catchAsync)(restaurants_1.createRestaurant));
router.get("/", (0, middlewares_1.hasPermission)("Restaurants", "View"), (0, catchAsync_1.catchAsync)(restaurants_1.getAllRestaurants));
router.get("/:id", (0, middlewares_1.hasPermission)("Restaurants", "View"), (0, catchAsync_1.catchAsync)(restaurants_1.getRestaurantById));
router.put("/:id", (0, middlewares_1.hasPermission)("Restaurants", "Edit"), 
//  validate(updateRestaurantSchema), 
(0, catchAsync_1.catchAsync)(restaurants_1.updateRestaurant));
router.put("/:id/delivery-status", (0, middlewares_1.hasPermission)("Restaurants", "Edit"), (0, catchAsync_1.catchAsync)(restaurants_1.changeDeliveryStatus));
router.delete("/:id", (0, middlewares_1.hasPermission)("Restaurants", "Delete"), (0, catchAsync_1.catchAsync)(restaurants_1.deleteRestaurant));
// Restaurant Domains
// GET  /api/admin/restaurants/:id/domains
router.get("/:id/domains", (0, validation_1.validate)(restaurantDomains_2.restaurantIdParamSchema, "params"), (0, catchAsync_1.catchAsync)(restaurantDomains_1.listDomains));
// POST /api/admin/restaurants/:id/domains
router.post("/:id/domains", (0, validation_1.validate)(restaurantDomains_2.restaurantIdParamSchema, "params"), (0, validation_1.validate)(restaurantDomains_2.addDomainSchema, "body"), (0, catchAsync_1.catchAsync)(restaurantDomains_1.addDomain));
exports.default = router;
