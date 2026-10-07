import { Router } from "express";
import { getRestaurantOperations, updateRestaurantOperation } from "../../controllers/admin/restaurantOperations";
import { validate } from "../../middlewares/validation";
import { hasPermission } from "../../middlewares/";
import {
    getRestaurantOperationsQuerySchema,
    updateRestaurantOperationParamsSchema,
    updateRestaurantOperationSchema,
} from "../../validation/admin/restaurantOperations";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.get(
    "/",
    hasPermission("RestaurantOperations", "View"),
    validate(getRestaurantOperationsQuerySchema, "query"),
    catchAsync(getRestaurantOperations)
);

router.put(
    "/:restaurantId",
    hasPermission("RestaurantOperations", "Edit"),
    validate(updateRestaurantOperationParamsSchema, "params"),
    validate(updateRestaurantOperationSchema),
    catchAsync(updateRestaurantOperation)
);

export default router;
