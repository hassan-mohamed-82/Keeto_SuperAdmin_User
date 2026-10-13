import { Router } from "express";
import {
    getAvailableCouriers,
    createDeliveryMan,
    assignExistingDeliveryMan,
    getDeliveryMen,
    getDeliveryManById,
    updateDeliveryMan,
    getCourierZones,
    updateCourierZones,
    getCourierShifts,
    updateCourierShifts,
    unassignOrDeleteDeliveryMan,
} from "../../controllers/shipping/deliveryMen";
import { validate } from "../../middlewares/validation";
import {
    createDeliveryManSchema,
    assignExistingDeliveryManSchema,
    updateDeliveryManSchema,
    setCourierZonesSchema,
    setCourierShiftsSchema,
} from "../../validation/shipping/deliveryMan";
import { authenticated } from "../../middlewares/authenticated";
import { requireShippingCompany } from "../../middlewares/shippingAuth";

const router = Router();

router.use(authenticated);

// Read routes: viewer, dispatcher, admin
router.get("/available", requireShippingCompany(), getAvailableCouriers);
router.get("/", requireShippingCompany(), getDeliveryMen);
router.get("/:id", requireShippingCompany(), getDeliveryManById);
router.get("/:id/zones", requireShippingCompany(), getCourierZones);
router.get("/:id/shifts", requireShippingCompany(), getCourierShifts);

// Mutation routes: admin and dispatcher
router.post("/", requireShippingCompany("admin", "dispatcher"), validate(createDeliveryManSchema), createDeliveryMan);
router.post("/assign-existing", requireShippingCompany("admin", "dispatcher"), validate(assignExistingDeliveryManSchema), assignExistingDeliveryMan);
router.put("/:id", requireShippingCompany("admin", "dispatcher"), validate(updateDeliveryManSchema), updateDeliveryMan);
router.put("/:id/zones", requireShippingCompany("admin", "dispatcher"), validate(setCourierZonesSchema), updateCourierZones);
router.put("/:id/shifts", requireShippingCompany("admin", "dispatcher"), validate(setCourierShiftsSchema), updateCourierShifts);

// Destructive unassign: admin only
router.delete("/:id", requireShippingCompany("admin"), unassignOrDeleteDeliveryMan);

export default router;
