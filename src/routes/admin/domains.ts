import { Router } from "express";
import rateLimit from "express-rate-limit";
import { catchAsync } from "../../utils/catchAsync";
import {
  checkSubdomain,
  verifyDomain,
  retryProvisioning,
  deleteDomain,
  setOrderLink,
} from "../../controllers/admin/restaurantDomains";
import { validate } from "../../middlewares/validation";
import {
  domainIdParamSchema,
  checkSubdomainQuerySchema,
} from "../../validation/admin/restaurantDomains";

const router = Router();

// Rate limiter for subdomain availability check: 60 req/min
const checkSubdomainLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many subdomain availability checks, please try again later." },
});

// GET /api/admin/domains/check-subdomain?label=flaky
router.get(
  "/check-subdomain",
  checkSubdomainLimiter,
  validate(checkSubdomainQuerySchema, "query"),
  catchAsync(checkSubdomain)
);

// POST /api/admin/domains/:domainId/verify
router.post(
  "/:domainId/verify",
  validate(domainIdParamSchema, "params"),
  catchAsync(verifyDomain)
);

// POST /api/admin/domains/:domainId/provision
router.post(
  "/:domainId/provision",
  validate(domainIdParamSchema, "params"),
  catchAsync(retryProvisioning)
);

// DELETE /api/admin/domains/:domainId
router.delete(
  "/:domainId",
  validate(domainIdParamSchema, "params"),
  catchAsync(deleteDomain)
);

// POST /api/admin/domains/:domainId/set-order-link
router.post(
  "/:domainId/set-order-link",
  validate(domainIdParamSchema, "params"),
  catchAsync(setOrderLink)
);

export default router;
