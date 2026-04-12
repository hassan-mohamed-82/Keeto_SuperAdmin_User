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

const router = Router();

router.get("/all", catchAsync(getallzone));
router.post("/", catchAsync(createZoneDeliveryFee));
router.get("/", catchAsync(getAllZoneDeliveryFees));
router.get("/:id", catchAsync(getZoneDeliveryFeeById));
router.put("/:id", catchAsync(updateZoneDeliveryFee));
router.delete("/:id", catchAsync(deleteZoneDeliveryFee));

export default router;
