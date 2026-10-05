import { Router } from "express";
import {
    createZone,
    getZones,
    getZoneById,
    updateZone,
    deleteZone,
} from "../../controllers/shipping/zones";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import {
    createShippingZoneSchema,
    updateShippingZoneSchema,
} from "../../validation/shipping/zone";
import { authenticated } from "../../middlewares/authenticated";

const router = Router();

router.use(authenticated);

router.post("/", validate(createShippingZoneSchema), catchAsync(createZone));
router.get("/", catchAsync(getZones));
router.get("/:id", catchAsync(getZoneById));
router.put("/:id", validate(updateShippingZoneSchema), catchAsync(updateZone));
router.delete("/:id", catchAsync(deleteZone));

export default router;
