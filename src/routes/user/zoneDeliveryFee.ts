import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getZoneAndDeliveryFee } from "../../controllers/user/zoneDeliveryFee";
import { validate } from "../../middlewares/validation";
import { getZoneDeliveryFeeSchema } from "../../validation/user/zoneDeliveryFee";

const router = Router();

// 🌐 Public: calculate zone and delivery fees for given coordinates
router.post(
    "/",
    validate(getZoneDeliveryFeeSchema),
    catchAsync(getZoneAndDeliveryFee)
);

export default router;
