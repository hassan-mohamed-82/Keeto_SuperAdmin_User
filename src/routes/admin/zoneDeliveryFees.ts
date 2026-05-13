import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    createZoneDeliveryFee,
    getAllZoneDeliveryFees,
    getZoneDeliveryFeeById,
    updateZoneDeliveryFee,
    deleteZoneDeliveryFee,
    getallzone
} from "../../controllers/admin/zoneDeliveryFees";
import { hasPermission } from "../../middlewares/";
import { validate } from "../../middlewares/validation";
import { createZoneDeliveryFeeSchema, updateZoneDeliveryFeeSchema } from "../../validation/admin/zoneDeliveryFees";
const router = Router();

router.get("/all", hasPermission("ZoneDeliveryFees", "View"), catchAsync(getallzone));
router.post("/", hasPermission("ZoneDeliveryFees", "Add"), validate(createZoneDeliveryFeeSchema), catchAsync(createZoneDeliveryFee));
router.get("/", hasPermission("ZoneDeliveryFees", "View"), catchAsync(getAllZoneDeliveryFees));
router.get("/:id", hasPermission("ZoneDeliveryFees", "View"), catchAsync(getZoneDeliveryFeeById));
router.put("/:id", hasPermission("ZoneDeliveryFees", "Edit"), validate(updateZoneDeliveryFeeSchema), catchAsync(updateZoneDeliveryFee));
router.delete("/:id", hasPermission("ZoneDeliveryFees", "Delete"), catchAsync(deleteZoneDeliveryFee));

export default router;
