import { Router } from "express";
import { getAssignedRestaurants, getRestaurantBranches } from "../../controllers/shipping/restaurants";
import { authenticated } from "../../middlewares/authenticated";
import { requireShippingCompany } from "../../middlewares/shippingAuth";

const router = Router();

router.use(authenticated, requireShippingCompany());

router.get("/", getAssignedRestaurants);
router.get("/:restaurantId/branches", getRestaurantBranches);

export default router;
