import { Router } from "express";
import { searchRestaurants, toggleAddHome, getHomeRestaurants, removeFromHome, getResturantSchedules, getRestaurantsBranches } from "../../controllers/user/restaurantFeatures";
import { catchAsync } from "../../utils/catchAsync";
import { authenticated, optionalAuth } from "../../middlewares/authenticated";

const router = Router();

router.get("/search", authenticated, catchAsync(searchRestaurants));
router.get("/home-list", authenticated, catchAsync(getHomeRestaurants));
router.put("/:restaurantId/addhome", authenticated, catchAsync(toggleAddHome));
router.delete("/:restaurantId/addhome", authenticated, catchAsync(removeFromHome));

router.get("/:restaurantId/branches", optionalAuth, catchAsync(getRestaurantsBranches));

//check if the restaurant is open
router.get("/resturant-schedules/:restaurantId", authenticated , catchAsync(getResturantSchedules))

export default router;
