import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import {
    createAlertGroup,
    getAllAlertGroups,
    getAlertGroupById,
    updateAlertGroup,
    toggleAlertGroupStatus,
    deleteAlertGroup,
    getRestaurantsLookup,
} from "../../controllers/admin/orderDelayAlert";
import { createOrderDelayAlertGroupSchema, updateOrderDelayAlertGroupSchema } from "../../validation/admin/orderDelayAlert";

const router = Router();

// 1. Create alert group
router.post("/", validate(createOrderDelayAlertGroupSchema), catchAsync(createAlertGroup));

// 2. Lookup restaurants (for multi-select dropdown)
router.get("/lookup-restaurants", catchAsync(getRestaurantsLookup));

// 3. Get all alert groups
router.get("/", catchAsync(getAllAlertGroups));

// 4. Get alert group by ID
router.get("/:id", catchAsync(getAlertGroupById));

// 5. Update alert group
router.put("/:id", validate(updateOrderDelayAlertGroupSchema), catchAsync(updateAlertGroup));

// 6. Toggle active status (supports both PATCH /:id/toggle and PUT /:id/toggle-status)
router.put("/:id/toggle-status", catchAsync(toggleAlertGroupStatus));

// 7. Delete alert group
router.delete("/:id", catchAsync(deleteAlertGroup));

export default router;

