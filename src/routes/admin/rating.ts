import { Router } from "express";
import {
    getRestaurantRatingStats,
    getRestaurantRatings,
    deleteRating,
    getAllCustomerRatings,
    getAllRestaurantRatings,
    updateRating,
    getAllRatingModerationRequests,
    approveRatingModerationRequest,
    rejectRatingModerationRequest,
} from "../../controllers/admin/rating";
import { catchAsync } from "../../utils/catchAsync";
import { hasPermission } from "../../middlewares/";
import { validate } from "../../middlewares/validation";
import {
    getAdminRatingRequestsQuerySchema,
    resolveRatingRequestSchema,
    ratingRequestIdParamSchema,
} from "../../validation/admin/rating";

const router = Router();

// ─── Moderation Requests (Pending List & Resolution) ───
// Placed before :restaurantId to prevent route shadowing
router.get("/requests", hasPermission("Ratings", "View"), validate(getAdminRatingRequestsQuerySchema, "query"), catchAsync(getAllRatingModerationRequests));
router.post("/requests/:id/approve", hasPermission("Ratings", "Edit"), validate(ratingRequestIdParamSchema, "params"), validate(resolveRatingRequestSchema, "body"), catchAsync(approveRatingModerationRequest));
router.post("/requests/:id/reject", hasPermission("Ratings", "Edit"), validate(ratingRequestIdParamSchema, "params"), validate(resolveRatingRequestSchema, "body"), catchAsync(rejectRatingModerationRequest));

router.get("/all-customer-ratings", hasPermission("Ratings", "View"), catchAsync(getAllCustomerRatings));
router.get("/all", hasPermission("Ratings", "View"), catchAsync(getAllRestaurantRatings));
router.get("/:restaurantId/stats", hasPermission("Ratings", "View"), catchAsync(getRestaurantRatingStats));
router.get("/:restaurantId", hasPermission("Ratings", "View"), catchAsync(getRestaurantRatings));
router.put("/:id", hasPermission("Ratings", "Edit"), catchAsync(updateRating));
router.delete("/:id", hasPermission("Ratings", "Delete"), catchAsync(deleteRating));

export default router;

