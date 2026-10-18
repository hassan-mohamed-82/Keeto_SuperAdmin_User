import { Router } from "express";
import { login, getProfile, getMyUserProfile, updateProfile } from "../../controllers/shipping/auth";
import { validate } from "../../middlewares/validation";
import { shippingLoginSchema } from "../../validation/shipping/auth";
import { authenticated } from "../../middlewares/authenticated";
import { requireShippingCompany } from "../../middlewares/shippingAuth";
import rateLimit from "express-rate-limit";

// const authLimiter = rateLimit({
//     windowMs: 15 * 60 * 1000, // 15 minutes
//     max: 10, // Limit each IP to 10 login attempts per windowMs
//     message: { success: false, message: "Too many login attempts. Please try again after 15 minutes." },
// });

const router = Router();

router.post("/login",validate(shippingLoginSchema), login);
router.get("/profile", authenticated, requireShippingCompany(), getProfile);
router.get("/me", authenticated, requireShippingCompany(), getMyUserProfile);
router.put("/profile", authenticated, updateProfile);

export default router;
