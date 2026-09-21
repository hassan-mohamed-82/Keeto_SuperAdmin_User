import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    getAllBundles,
    getBundleById,
} from "../../controllers/user/bundles";
import { validate } from "../../middlewares/validation";
import { optionalAuth } from "../../middlewares/authenticated";
import {
    getAllBundlesQuerySchema,
    getBundleByIdParamsSchema,
} from "../../validation/user/bundles";

const router = Router();

// ─── Bundle Offers Retrieval ──────────────────────────────────────────────────
// 1. List active bundle offers (GET /offers/bundles)
router.get(
    "",
    optionalAuth,
    validate(getAllBundlesQuerySchema, "query"),
    catchAsync(getAllBundles)
);

// 2. Get single bundle offer details (GET /offers/bundles/:offerId)
router.get(
    "/:id",
    optionalAuth,
    validate(getBundleByIdParamsSchema, "params"),
    catchAsync(getBundleById)
);

export default router;