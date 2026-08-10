import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getOrdersByRestaurant, getOrderDetails, getAllOrders, updateOrderStatus, getReasons } from "../../controllers/admin/order";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.get("/all", hasPermission("Orders", "View"), catchAsync(getAllOrders));
router.get("/reasons", hasPermission("Orders", "View"), catchAsync(getReasons));


router.get("/:restaurantId", hasPermission("Orders", "View"), catchAsync(getOrdersByRestaurant));
router.get("/:restaurantId/:orderId", hasPermission("Orders", "View"), catchAsync(getOrderDetails));
router.put("/:restaurantId/:orderId/status", hasPermission("Orders", "Edit"), catchAsync(updateOrderStatus));
export default router;