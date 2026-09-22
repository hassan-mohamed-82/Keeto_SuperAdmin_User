import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    checkout, getOrderDetails, getActiveOrders, getOrderHistory
    , getOrderPrerequisites, cancelOrder, getCancelReasons, rateOrder
} from "../../controllers/user/order";
import { validate } from "../../middlewares/validation";
import { checkoutSchema } from "../../validation/user/order";

const router = Router();
router.put("/:orderId/cancel", catchAsync(cancelOrder));
router.post("/:orderId/rate", catchAsync(rateOrder));
router.get("/select", catchAsync(getOrderPrerequisites));
router.get("/cancel-reasons", catchAsync(getCancelReasons));
// router.post("/checkout", validate(checkoutSchema), catchAsync(checkout));
router.post("/checkout", catchAsync(checkout));
router.get("/active", catchAsync(getActiveOrders));
router.get("/history", catchAsync(getOrderHistory));
router.get("/:orderId", catchAsync(getOrderDetails));
export default router;