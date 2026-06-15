import { Router } from "express";
import { searchRestaurants, toggleAddHome, getHomeRestaurants, removeFromHome, getResturantSchedules } from "../../controllers/user/restaurantFeatures";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.get("/search", catchAsync(searchRestaurants));
router.get("/home-list", catchAsync(getHomeRestaurants));
router.put("/:restaurantId/addhome", catchAsync(toggleAddHome));
router.delete("/:restaurantId/addhome", catchAsync(removeFromHome));

//check if the restaurant is open
router.get("/resturant-schedules/:restaurantId", catchAsync(getResturantSchedules))

export default router;
