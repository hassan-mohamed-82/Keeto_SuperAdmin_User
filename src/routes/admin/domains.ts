import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  verifyDomain,
  retryProvisioning,
  deleteDomain,
  setOrderLink,
} from "../../controllers/admin/restaurantDomains";
import { validate } from "../../middlewares/validation";
import { domainIdParamSchema } from "../../validation/admin/restaurantDomains";

const router = Router();

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
