import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getOrdersByRestaurant, getOrderDetails } from "../../controllers/admin/order";
import { hasPermission } from "../../middlewares/";
const router = Router();
router.get("/:restaurantId", hasPermission("Orders", "View"), catchAsync(getOrdersByRestaurant));
router.get("/:restaurantId/:orderId", hasPermission("Orders", "View"), catchAsync(getOrderDetails));
export default router;