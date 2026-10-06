import { Router } from "express";
import { getPlatformPaymentSettings, updatePlatformPaymentSettings } from "../../controllers/admin/platformPaymentSettings";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { updatePlatformPaymentSettingsSchema } from "../../validation/admin/platformPaymentSettings";
import { hasPermission } from "../../middlewares/";

const router = Router();

router.get("/", hasPermission("PlatformPaymentSettings", "View"), catchAsync(getPlatformPaymentSettings));
router.put("/", hasPermission("PlatformPaymentSettings", "Edit"), validate(updatePlatformPaymentSettingsSchema), catchAsync(updatePlatformPaymentSettings));

export default router;
