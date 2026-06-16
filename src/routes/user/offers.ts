import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getRestaurantOffers,getAllOffers } from "../../controllers/user/offers";

const router = Router();
router.get("/", catchAsync(getAllOffers));
router.get("/restaurant/:restaurantId/offers", catchAsync(getRestaurantOffers));
export default router;