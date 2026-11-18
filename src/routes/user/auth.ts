import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middlewares/validation";
import { signupSchema } from "../../validation/user/auth";
import { catchAsync } from "../../utils/catchAsync";
import {
    signup,
    verifyEmail,
    login,
    forgotPassword,
    verifyResetCode,
    resetPassword,
    initGuestSession,
} from "../../controllers/user/auth";
import { facebookLoginOrSignup } from "../../config/facebook";
import { verifyGoogleToken } from "../../config/passport";
import { verifyAppleToken } from "../../config/verifyAppleToken";
import authHandoffRouter from "./authHandoff";

const router = Router();

// 🛡️ Rate limiter for endpoints that send emails — prevents SMTP abuse
const emailRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,                    // max 5 requests per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please try again after 15 minutes." },
});

// 🛡️ Rate limiter for login — prevents brute force
const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many login attempts. Please try again after 15 minutes." },
});

// Subdomain & Custom Domain Auth Handoff (also mounted directly at /api/auth)
router.use(authHandoffRouter);

router.post("/signup", emailRateLimit, validate(signupSchema), catchAsync(signup));
router.get("/verify-email", catchAsync(verifyEmail));
router.post("/login", loginRateLimit, catchAsync(login));
router.post("/forgot-password", emailRateLimit, catchAsync(forgotPassword));
router.post("/verify-reset-code", catchAsync(verifyResetCode));
router.post("/reset-password", catchAsync(resetPassword));

// 🌐 Public: initialize a guest session — no auth required
router.post("/guest-session", catchAsync(initGuestSession));

router.post("/google", catchAsync(verifyGoogleToken));
router.post("/facebook", catchAsync(facebookLoginOrSignup));
router.post("/apple", catchAsync(verifyAppleToken));
export default router;
