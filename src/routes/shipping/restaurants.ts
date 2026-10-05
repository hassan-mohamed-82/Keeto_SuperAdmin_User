import { Router } from "express";
import { getAssignedRestaurants, getRestaurantBranches } from "../../controllers/shipping/restaurants";
import { catchAsync } from "../../utils/catchAsync";
import { authenticated } from "../../middlewares/authenticated";

const router = Router();

router.use(authenticated);

router.get("/", catchAsync(getAssignedRestaurants));
router.get("/:restaurantId/branches", catchAsync(getRestaurantBranches));

export default router;
