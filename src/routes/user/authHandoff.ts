import { Router } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { authenticated } from "../../middlewares/authenticated";
import { validate } from "../../middlewares/validation";
import { catchAsync } from "../../utils/catchAsync";
import { isAllowedOrigin } from "../../utils/cors";
import { handoff, exchangeCode } from "../../controllers/user/authHandoff";
import { handoffSchema, exchangeCodeSchema } from "../../validation/user/authHandoff.validation";

const router = Router();

// Rate limiter for handoff requests
const handoffLimiter = rateLimit({
  windowMs: 60_000,
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
const exchangeLimiter = rateLimit({
  windowMs: 60_000,
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
const exchangeCors = cors({
  origin: async (origin, callback) => {
    try {
      if (!origin) return callback(null, true);
      const allowed = await isAllowedOrigin(origin);
      if (allowed) {
        return callback(null, true);
      }
      return callback(null, false);
    } catch {
      return callback(null, false);
    }
  },
  credentials: true,
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"],
});

// POST /api/auth/handoff (requires authenticated user)
router.post(
  "/handoff",
  authenticated,
  handoffLimiter,
  validate(handoffSchema),
  catchAsync(handoff)
);

// OPTIONS & POST /api/auth/exchange-code (public, rate limited, CORS allowed for verified custom domains)
router.options("/exchange-code", exchangeCors);
router.post(
  "/exchange-code",
  exchangeCors,
  exchangeLimiter,
  validate(exchangeCodeSchema),
  catchAsync(exchangeCode)
);

export default router;

