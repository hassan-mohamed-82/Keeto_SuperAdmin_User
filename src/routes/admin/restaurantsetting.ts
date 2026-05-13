import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { updateSettings, getSettingsByRestaurantId } from "../../controllers/admin/restaurantsetting";
import { validate } from "../../middlewares/validation";
import { updateRestaurantSettingsSchema } from "../../validation/admin/restaurantsetting";
import { hasPermission } from "../../middlewares/";
const router = Router();
router.get("/:restaurantId", hasPermission("RestaurantSettings", "View"), catchAsync(getSettingsByRestaurantId));
router.put("/:restaurantId", hasPermission("RestaurantSettings", "Edit"), validate(updateRestaurantSettingsSchema), catchAsync(updateSettings));

export default router;
