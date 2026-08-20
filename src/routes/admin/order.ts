import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getOrdersByRestaurant, getOrderDetails, getAllOrders, updateOrderStatus, getReasons, assignDelivery, setOrderPreparingDuration, selectDeliveryMan } from "../../controllers/admin/order";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.get("/all", hasPermission("Orders", "View"), catchAsync(getAllOrders));
router.get("/reasons", hasPermission("Orders", "View"), catchAsync(getReasons));
router.get("/select", hasPermission("Orders", "View"), catchAsync(selectDeliveryMan))

router.get("/:restaurantId", hasPermission("Orders", "View"), catchAsync(getOrdersByRestaurant));
router.get("/:restaurantId/:orderId", hasPermission("Orders", "View"), catchAsync(getOrderDetails));
router.put("/:restaurantId/:orderId/status", hasPermission("Orders", "Edit"), catchAsync(updateOrderStatus));

router.put("/:orderId/assign-delivery", hasPermission("Orders", "Edit"), catchAsync(assignDelivery));
router.put("/:orderId/duration", hasPermission("Orders", "Edit"), catchAsync(setOrderPreparingDuration));

export default router;