import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { checkout, getOrderDetails, getUserOrders } from "../../controllers/user/order";
const router = Router();
router.post("/checkout", catchAsync(checkout));
router.get("/", catchAsync(getUserOrders));
router.get("/:orderId", catchAsync(getOrderDetails));
export default router;