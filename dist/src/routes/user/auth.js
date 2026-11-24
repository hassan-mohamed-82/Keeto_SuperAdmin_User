"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const validation_1 = require("../../middlewares/validation");
const auth_1 = require("../../validation/user/auth");
const catchAsync_1 = require("../../utils/catchAsync");
const auth_2 = require("../../controllers/user/auth");
const facebook_1 = require("../../config/facebook");
const passport_1 = require("../../config/passport");
const verifyAppleToken_1 = require("../../config/verifyAppleToken");
const authHandoff_1 = __importDefault(require("./authHandoff"));
const router = (0, express_1.Router)();
// 🛡️ Rate limiter for endpoints that send emails — prevents SMTP abuse
const emailRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // max 5 requests per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Please try again after 15 minutes." },
});
// 🛡️ Rate limiter for login — prevents brute force
const loginRateLimit = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many login attempts. Please try again after 15 minutes." },
});
// Subdomain & Custom Domain Auth Handoff (also mounted directly at /api/auth)
router.use(authHandoff_1.default);
router.post("/signup", emailRateLimit, (0, validation_1.validate)(auth_1.signupSchema), (0, catchAsync_1.catchAsync)(auth_2.signup));
router.get("/verify-email", (0, catchAsync_1.catchAsync)(auth_2.verifyEmail));
router.post("/login", loginRateLimit, (0, catchAsync_1.catchAsync)(auth_2.login));
router.post("/forgot-password", emailRateLimit, (0, catchAsync_1.catchAsync)(auth_2.forgotPassword));
router.post("/verify-reset-code", (0, catchAsync_1.catchAsync)(auth_2.verifyResetCode));
router.post("/reset-password", (0, catchAsync_1.catchAsync)(auth_2.resetPassword));
// 🌐 Public: initialize a guest session — no auth required
router.post("/guest-session", (0, catchAsync_1.catchAsync)(auth_2.initGuestSession));
router.post("/google", (0, catchAsync_1.catchAsync)(passport_1.verifyGoogleToken));
router.post("/facebook", (0, catchAsync_1.catchAsync)(facebook_1.facebookLoginOrSignup));
router.post("/apple", (0, catchAsync_1.catchAsync)(verifyAppleToken_1.verifyAppleToken));
exports.default = router;
