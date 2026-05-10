import { Router } from "express";
import { searchRestaurants, toggleAddHome, getHomeRestaurants, removeFromHome } from "../../controllers/user/restaurantFeatures";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.get("/search", catchAsync(searchRestaurants));
router.get("/home-list", catchAsync(getHomeRestaurants));
router.put("/:restaurantId/addhome", catchAsync(toggleAddHome));
router.delete("/:restaurantId/addhome", catchAsync(removeFromHome));

export default router;
