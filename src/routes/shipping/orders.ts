import { Router } from "express";
import {
    getOrders,
    getOrderDetails,
    manualAssignDeliveryMan,
    autoAssignOrder,
} from "../../controllers/shipping/orders";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import {
    filterShippingOrdersSchema,
    assignOrderDeliveryManSchema,
    autoAssignOrderSchema,
} from "../../validation/shipping/order";
import { authenticated } from "../../middlewares/authenticated";

const router = Router();

router.use(authenticated);

router.get("/", validate(filterShippingOrdersSchema, "query"), catchAsync(getOrders));
router.get("/:id", catchAsync(getOrderDetails));
router.post("/:id/assign-delivery", validate(assignOrderDeliveryManSchema), catchAsync(manualAssignDeliveryMan));
router.post("/:id/auto-assign", validate(autoAssignOrderSchema), catchAsync(autoAssignOrder));

export default router;
