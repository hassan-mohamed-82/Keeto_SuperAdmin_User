import { Router } from "express";
import {
    getOrders,
    getOrderDetails,
    manualAssignDeliveryMan,
    autoAssignOrder,
    markOrderPickedUp,
    markOrderDelivered,
    rejectOrderCourierEndpoint,
} from "../../controllers/shipping/orders";
import { validate } from "../../middlewares/validation";
import {
    assignOrderDeliveryManSchema,
    autoAssignOrderSchema,
    filterShippingOrdersSchema,
} from "../../validation/shipping/order";
import { authenticated } from "../../middlewares/authenticated";
import { requireShippingCompany } from "../../middlewares/shippingAuth";
import { rejectOrderSchema } from "../../validation/shipping/order";
import { requireDeliveryMan } from "../../middlewares/shippingAuth";

const router = Router();

router.use(authenticated);

router.get("/", requireShippingCompany(), validate(filterShippingOrdersSchema, "query"), getOrders);

// Courier Order lifecycle endpoints (Phase 8)
router.post("/orders/:id/picked-up", authenticated, requireDeliveryMan, markOrderPickedUp);
router.post("/orders/:id/delivered", authenticated, requireDeliveryMan, markOrderDelivered);
router.post("/orders/:id/reject", authenticated, requireDeliveryMan, validate(rejectOrderSchema), rejectOrderCourierEndpoint);

router.get("/:id", requireShippingCompany(), getOrderDetails);
router.post("/:id/assign", requireShippingCompany("admin", "dispatcher"), validate(assignOrderDeliveryManSchema), manualAssignDeliveryMan);
router.post("/:id/auto-assign", requireShippingCompany("admin", "dispatcher"), validate(autoAssignOrderSchema), autoAssignOrder);

export default router;

