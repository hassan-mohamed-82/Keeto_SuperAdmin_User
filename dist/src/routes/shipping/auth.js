"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../controllers/shipping/auth");
const validation_1 = require("../../middlewares/validation");
const auth_2 = require("../../validation/shipping/auth");
const authenticated_1 = require("../../middlewares/authenticated");
const shippingAuth_1 = require("../../middlewares/shippingAuth");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login attempts per windowMs
    message: { success: false, message: "Too many login attempts. Please try again after 15 minutes." },
});
const router = (0, express_1.Router)();
router.post("/login", authLimiter, (0, validation_1.validate)(auth_2.shippingLoginSchema), auth_1.login);
router.get("/profile", authenticated_1.authenticated, (0, shippingAuth_1.requireShippingCompany)(), auth_1.getProfile);
router.get("/me", authenticated_1.authenticated, (0, shippingAuth_1.requireShippingCompany)(), auth_1.getMyUserProfile);
router.put("/profile", authenticated_1.authenticated, auth_1.updateProfile);
exports.default = router;
