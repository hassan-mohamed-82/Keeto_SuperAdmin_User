import { Router } from "express";
import { getRestaurantSettings } from "../../controllers/user/restaurantSettings";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.get("/:restaurantId", catchAsync(getRestaurantSettings));

export default router;
