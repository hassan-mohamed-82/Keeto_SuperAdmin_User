"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const rating_1 = require("../../controllers/admin/rating");
const catchAsync_1 = require("../../utils/catchAsync");
const middlewares_1 = require("../../middlewares/");
const validation_1 = require("../../middlewares/validation");
const rating_2 = require("../../validation/admin/rating");
const router = (0, express_1.Router)();
// ─── Moderation Requests (Pending List & Resolution) ───
// Placed before :restaurantId to prevent route shadowing
router.get("/requests", (0, middlewares_1.hasPermission)("Ratings", "View"), (0, validation_1.validate)(rating_2.getAdminRatingRequestsQuerySchema, "query"), (0, catchAsync_1.catchAsync)(rating_1.getAllRatingModerationRequests));
router.post("/requests/:id/approve", (0, middlewares_1.hasPermission)("Ratings", "Edit"), (0, validation_1.validate)(rating_2.ratingRequestIdParamSchema, "params"), (0, validation_1.validate)(rating_2.resolveRatingRequestSchema, "body"), (0, catchAsync_1.catchAsync)(rating_1.approveRatingModerationRequest));
router.post("/requests/:id/reject", (0, middlewares_1.hasPermission)("Ratings", "Edit"), (0, validation_1.validate)(rating_2.ratingRequestIdParamSchema, "params"), (0, validation_1.validate)(rating_2.resolveRatingRequestSchema, "body"), (0, catchAsync_1.catchAsync)(rating_1.rejectRatingModerationRequest));
router.get("/all-customer-ratings", (0, middlewares_1.hasPermission)("Ratings", "View"), (0, catchAsync_1.catchAsync)(rating_1.getAllCustomerRatings));
router.get("/all", (0, middlewares_1.hasPermission)("Ratings", "View"), (0, catchAsync_1.catchAsync)(rating_1.getAllRestaurantRatings));
router.get("/:restaurantId/stats", (0, middlewares_1.hasPermission)("Ratings", "View"), (0, catchAsync_1.catchAsync)(rating_1.getRestaurantRatingStats));
router.get("/:restaurantId", (0, middlewares_1.hasPermission)("Ratings", "View"), (0, catchAsync_1.catchAsync)(rating_1.getRestaurantRatings));
router.put("/:id", (0, middlewares_1.hasPermission)("Ratings", "Edit"), (0, catchAsync_1.catchAsync)(rating_1.updateRating));
router.delete("/:id", (0, middlewares_1.hasPermission)("Ratings", "Delete"), (0, catchAsync_1.catchAsync)(rating_1.deleteRating));
exports.default = router;
