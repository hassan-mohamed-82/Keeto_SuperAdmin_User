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
import { courierLogin, getCourierProfile } from "../../controllers/shipping/auth";
import { courierLoginSchema } from "../../validation/shipping/auth";
import { rejectOrderSchema } from "../../validation/shipping/order";
import { requireDeliveryMan } from "../../middlewares/shippingAuth";
import rateLimit from "express-rate-limit";


const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: "Too many login attempts. Please try again after 15 minutes." },
});

const router = Router();

router.use(authenticated);

router.get("/", requireShippingCompany(), validate(filterShippingOrdersSchema), getOrders);
router.get("/:id", requireShippingCompany(), getOrderDetails);
router.post("/:id/assign", requireShippingCompany("admin", "dispatcher"), validate(assignOrderDeliveryManSchema), manualAssignDeliveryMan);
router.post("/:id/auto-assign", requireShippingCompany("admin", "dispatcher"), validate(autoAssignOrderSchema), autoAssignOrder);


// Courier Auth
router.post("/auth/login", authLimiter, validate(courierLoginSchema), courierLogin);

// Courier Me
router.get("/me", authenticated, requireDeliveryMan, getCourierProfile);

// Courier Order lifecycle endpoints (Phase 8)
router.post("/orders/:id/picked-up", authenticated, requireDeliveryMan, markOrderPickedUp);
router.post("/orders/:id/delivered", authenticated, requireDeliveryMan, markOrderDelivered);
router.post("/orders/:id/reject", authenticated, requireDeliveryMan, validate(rejectOrderSchema), rejectOrderCourierEndpoint);

export default router;

