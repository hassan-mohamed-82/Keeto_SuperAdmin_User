import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getOrdersByRestaurant } from "../../controllers/admin/order";
const router = Router();
router.get("/:restaurantId", catchAsync(getOrdersByRestaurant));
export default router;