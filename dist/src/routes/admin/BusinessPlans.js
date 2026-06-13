"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const BusinessPlans_1 = require("../../controllers/admin/BusinessPlans");
const catchAsync_1 = require("../../utils/catchAsync");
const middlewares_1 = require("../../middlewares/");
const router = (0, express_1.Router)();
router.get("/", (0, middlewares_1.hasPermission)("BusninessPlan", "View"), (0, catchAsync_1.catchAsync)(BusinessPlans_1.getallresstrauntplans));
router.post("/", // validate(createBusinessPlanSchema),
(0, middlewares_1.hasPermission)("BusninessPlan", "Add"), (0, catchAsync_1.catchAsync)(BusinessPlans_1.createBusinessPlan));
router.get("/restaurant/:restaurantId", (0, middlewares_1.hasPermission)("BusninessPlan", "View"), (0, catchAsync_1.catchAsync)(BusinessPlans_1.getBusinessPlansByRestaurant));
router.get("/:id", (0, middlewares_1.hasPermission)("BusninessPlan", "View"), (0, catchAsync_1.catchAsync)(BusinessPlans_1.getBusinessPlanById));
router.put("/:id", // validate(updateBusinessPlanSchema)
(0, middlewares_1.hasPermission)("BusninessPlan", "Edit"), (0, catchAsync_1.catchAsync)(BusinessPlans_1.updateBusinessPlan));
router.delete("/:id", (0, middlewares_1.hasPermission)("BusninessPlan", "Delete"), (0, catchAsync_1.catchAsync)(BusinessPlans_1.deleteBusinessPlan));
exports.default = router;
