import { Router } from "express";
import { getRestaurantRatingStats, getRestaurantRatings, deleteRating, getAllCustomerRatings, getAllRestaurantRatings, updateRating } from "../../controllers/admin/rating";
import { catchAsync } from "../../utils/catchAsync";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.get("/all-customer-ratings", hasPermission("Ratings", "View"), catchAsync(getAllCustomerRatings));
router.get("/all", hasPermission("Ratings", "View"), catchAsync(getAllRestaurantRatings));
router.get("/:restaurantId/stats", hasPermission("Ratings", "View"), catchAsync(getRestaurantRatingStats));
router.get("/:restaurantId", hasPermission("Ratings", "View"), catchAsync(getRestaurantRatings));
router.put("/:id", hasPermission("Ratings", "Edit"), catchAsync(updateRating));
router.delete("/:id", hasPermission("Ratings", "Delete"), catchAsync(deleteRating));

export default router;
