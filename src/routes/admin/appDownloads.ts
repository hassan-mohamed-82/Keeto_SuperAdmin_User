import { Router } from "express";
import {
    getAppDownloads,
    getRestaurantAppDownloads,
    syncAppDownloadsHandler,
} from "../../controllers/admin/appDownloads";
import { hasPermission } from "../../middlewares/";
import { validate } from "../../middlewares/validation";
import { catchAsync } from "../../utils/catchAsync";
import {
    getAppDownloadsQuerySchema,
    restaurantAppDownloadsParamsSchema,
    restaurantAppDownloadsQuerySchema,
    syncAppDownloadsSchema,
} from "../../validation/admin/appDownloads";

const router = Router();

// Pull fresh numbers from Google Play + App Store Connect (call it whenever you want)
router.post(
    "/sync",
    hasPermission("AppDownloads", "Edit"),
    validate(syncAppDownloadsSchema),
    catchAsync(syncAppDownloadsHandler)
);

// Totals per restaurant
router.get(
    "/",
    hasPermission("AppDownloads", "View"),
    validate(getAppDownloadsQuerySchema, "query"),
    catchAsync(getAppDownloads)
);

// One restaurant over time
router.get(
    "/:restaurantId",
    hasPermission("AppDownloads", "View"),
    validate(restaurantAppDownloadsParamsSchema, "params"),
    validate(restaurantAppDownloadsQuerySchema, "query"),
    catchAsync(getRestaurantAppDownloads)
);

export default router;
