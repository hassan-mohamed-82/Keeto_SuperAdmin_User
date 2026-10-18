import { Router } from "express";
import { login, getProfile, getMyUserProfile, updateProfile } from "../../controllers/shipping/auth";
import { validate } from "../../middlewares/validation";
import { shippingLoginSchema } from "../../validation/shipping/auth";
import { authenticated } from "../../middlewares/authenticated";
import { requireShippingCompany } from "../../middlewares/shippingAuth";


const router = Router();

router.post("/login",validate(shippingLoginSchema), login);
router.get("/profile", authenticated, requireShippingCompany(), getProfile);
router.get("/me", authenticated, requireShippingCompany(), getMyUserProfile);
router.put("/profile", authenticated, updateProfile);

export default router;
