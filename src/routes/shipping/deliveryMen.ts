import { Router } from "express";
import {
    createDeliveryMan,
    assignExistingDeliveryMan,
    getDeliveryMen,
    getDeliveryManById,
    updateDeliveryMan,
    toggleShift,
    updateLocation,
    unassignOrDeleteDeliveryMan,
} from "../../controllers/shipping/deliveryMen";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import {
    createDeliveryManSchema,
    assignExistingDeliveryManSchema,
    updateDeliveryManSchema,
    toggleDeliveryShiftSchema,
    updateDeliveryLocationSchema,
} from "../../validation/shipping/deliveryMan";
import { authenticated } from "../../middlewares/authenticated";

const router = Router();

router.use(authenticated);

router.post("/", validate(createDeliveryManSchema), catchAsync(createDeliveryMan));
router.post("/assign-existing", validate(assignExistingDeliveryManSchema), catchAsync(assignExistingDeliveryMan));
router.get("/", catchAsync(getDeliveryMen));
router.get("/:id", catchAsync(getDeliveryManById));
router.put("/:id", validate(updateDeliveryManSchema), catchAsync(updateDeliveryMan));
router.patch("/:id/shift", validate(toggleDeliveryShiftSchema), catchAsync(toggleShift));
router.patch("/:id/location", validate(updateDeliveryLocationSchema), catchAsync(updateLocation));
router.delete("/:id", catchAsync(unassignOrDeleteDeliveryMan));

export default router;
