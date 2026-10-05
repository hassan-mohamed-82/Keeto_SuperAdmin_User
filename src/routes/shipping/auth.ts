import { Router } from "express";
import { login, getProfile, updateProfile } from "../../controllers/shipping/auth";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { shippingLoginSchema, shippingUpdateProfileSchema } from "../../validation/shipping/auth";
import { authenticated } from "../../middlewares/authenticated";

const router = Router();

router.post("/login", validate(shippingLoginSchema), catchAsync(login));
router.get("/profile", authenticated, catchAsync(getProfile));
router.put("/profile", authenticated, validate(shippingUpdateProfileSchema), catchAsync(updateProfile));

export default router;
