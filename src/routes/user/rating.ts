import { Router } from "express";
import { rateRestaurant, getMyRating ,getRestaurantRatings} from "../../controllers/user/rating";
import { catchAsync } from "../../utils/catchAsync";
import { authenticated } from "../../middlewares/authenticated";

const router = Router();

router.post("/",authenticated,catchAsync(rateRestaurant));
router.get("/:restaurantId", catchAsync(getMyRating));
router.get("/restaurant/:restaurantId", catchAsync(getRestaurantRatings));


export default router;
