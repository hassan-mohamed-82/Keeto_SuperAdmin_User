import { Router } from "express";
import rateLimit from "express-rate-limit";
import { catchAsync } from "../utils/catchAsync";
import { resolveDomain } from "../controllers/admin/restaurantDomains";
import { validate } from "../middlewares/validation";
import { resolveDomainQuerySchema } from "../validation/admin/restaurantDomains";

const router = Router();

// Rate limit: 30 req/min per IP
const resolveLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// GET /api/resolve-domain?host=order.pizzaking.com
router.get(
  "/",
  resolveLimiter,
  validate(resolveDomainQuerySchema, "query"),
  catchAsync(resolveDomain)
);

export default router;
