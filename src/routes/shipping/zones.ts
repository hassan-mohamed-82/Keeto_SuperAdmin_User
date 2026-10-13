import { Router } from "express";
import {
    createZone,
    getZones,
    getZoneById,
    updateZone,
    deleteZone,
} from "../../controllers/shipping/zones";
import { validate } from "../../middlewares/validation";
import {
    createShippingZoneSchema,
    updateShippingZoneSchema,
} from "../../validation/shipping/zone";
import { authenticated } from "../../middlewares/authenticated";
import { requireShippingCompany } from "../../middlewares/shippingAuth";

const router = Router();

router.use(authenticated);

router.get("/", requireShippingCompany(), getZones);
router.get("/:id", requireShippingCompany(), getZoneById);
router.post("/", requireShippingCompany("admin", "dispatcher"), validate(createShippingZoneSchema), createZone);
router.put("/:id", requireShippingCompany("admin", "dispatcher"), validate(updateShippingZoneSchema), updateZone);
router.delete("/:id", requireShippingCompany("admin"), deleteZone);

export default router;
