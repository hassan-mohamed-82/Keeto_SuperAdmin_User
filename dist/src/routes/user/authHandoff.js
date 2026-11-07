"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const authenticated_1 = require("../../middlewares/authenticated");
const validation_1 = require("../../middlewares/validation");
const catchAsync_1 = require("../../utils/catchAsync");
const cors_2 = require("../../utils/cors");
const authHandoff_1 = require("../../controllers/user/authHandoff");
const authHandoff_validation_1 = require("../../validation/user/authHandoff.validation");
const router = (0, express_1.Router)();
// Rate limiter for handoff requests
const handoffLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: 429,
            message: "Too many requests, please try again later.",
            details: "Too many requests, please try again later.",
        },
    },
});
// Rate limiter for exchange-code requests (public endpoint)
const exchangeLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: {
            code: 429,
            message: "Too many requests, please try again later.",
            details: "Too many requests, please try again later.",
        },
    },
});
// Dynamic CORS configuration allowing verified custom domains and platform domains
const exchangeCors = (0, cors_1.default)({
    origin: async (origin, callback) => {
        try {
            if (!origin)
                return callback(null, true);
            const allowed = await (0, cors_2.isAllowedOrigin)(origin);
            if (allowed) {
                return callback(null, true);
            }
            return callback(null, false);
        }
        catch {
            return callback(null, false);
        }
    },
    credentials: true,
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
});
// POST /api/auth/handoff (requires authenticated user)
router.post("/handoff", authenticated_1.authenticated, handoffLimiter, (0, validation_1.validate)(authHandoff_validation_1.handoffSchema), (0, catchAsync_1.catchAsync)(authHandoff_1.handoff));
// OPTIONS & POST /api/auth/exchange-code (public, rate limited, CORS allowed for verified custom domains)
router.options("/exchange-code", exchangeCors);
router.post("/exchange-code", exchangeCors, exchangeLimiter, (0, validation_1.validate)(authHandoff_validation_1.exchangeCodeSchema), (0, catchAsync_1.catchAsync)(authHandoff_1.exchangeCode));
exports.default = router;
