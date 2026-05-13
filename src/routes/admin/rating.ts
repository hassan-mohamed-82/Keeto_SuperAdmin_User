import { Router } from "express";
import { getRestaurantRatingStats, getRestaurantRatings, deleteRating } from "../../controllers/admin/rating";
import { catchAsync } from "../../utils/catchAsync";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.get("/:restaurantId/stats", hasPermission("Ratings", "View"), catchAsync(getRestaurantRatingStats));
router.get("/:restaurantId", hasPermission("Ratings", "View"), catchAsync(getRestaurantRatings));
router.delete("/:id", hasPermission("Ratings", "Delete"), catchAsync(deleteRating));

export default router;
