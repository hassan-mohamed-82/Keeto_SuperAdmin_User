import { Router } from "express";
import { getRestaurantSettings } from "../../controllers/user/restaurantSettings";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { getRestaurantSettingsParamsSchema } from "../../validation/user/restaurantSettings";

const router = Router();

router.get(
  "/:restaurantId",
  validate(getRestaurantSettingsParamsSchema, "params"),
  catchAsync(getRestaurantSettings)
);

export default router;

