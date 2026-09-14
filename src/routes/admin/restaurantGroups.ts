import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    createRestaurantGroup,
    getAllRestaurantGroups,
    getRestaurantGroupById,
    updateRestaurantGroup,
    deleteRestaurantGroup,
    toggleRestaurantGroupStatus,
} from "../../controllers/admin/restaurantGroups";
import { validate } from "../../middlewares/validation";
import {
    createRestaurantGroupSchema,
    updateRestaurantGroupSchema,
} from "../../validation/admin/restaurantGroups";
import { hasPermission } from "../../middlewares/";

const router = Router();

// 1. Create a new restaurant group
router.post(
    "/",
    hasPermission("Restaurants", "Add"),
    validate(createRestaurantGroupSchema),
    catchAsync(createRestaurantGroup)
);

// 2. Get all restaurant groups
router.get(
    "/",
    hasPermission("Restaurants", "View"),
    catchAsync(getAllRestaurantGroups)
);

// 3. Get restaurant group by ID
router.get(
    "/:id",
    hasPermission("Restaurants", "View"),
    catchAsync(getRestaurantGroupById)
);

// 4. Update restaurant group
router.put(
    "/:id",
    hasPermission("Restaurants", "Edit"),
    validate(updateRestaurantGroupSchema),
    catchAsync(updateRestaurantGroup)
);

// 5. Delete restaurant group
router.delete(
    "/:id",
    hasPermission("Restaurants", "Delete"),
    catchAsync(deleteRestaurantGroup)
);

// 6. Toggle active/inactive status
router.put(
    "/:id/toggle-status",
    hasPermission("Restaurants", "Status"),
    catchAsync(toggleRestaurantGroupStatus)
);

export default router;
