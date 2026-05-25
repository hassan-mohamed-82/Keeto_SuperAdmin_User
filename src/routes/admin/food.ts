import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    createFood,
    getAllFoods,
    getFoodById,
    updateFood,
    deleteFood,
    getFoodSelectData,
    getFoodsByRestaurantId,
    toggleVariationStatus,
    toggleOptionStatus,
    toggleOptionDefault
} from "../../controllers/admin/food";
import { validate } from "../../middlewares/validation";
import { createFoodSchema, updateFoodSchema } from "../../validation/admin/food";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.get("/select", catchAsync(getFoodSelectData));
router.get("/restaurant/:id", catchAsync(getFoodsByRestaurantId));
router.post("/",
    //  validate(createFoodSchema),
    hasPermission("Food", "Add"), catchAsync(createFood));
router.get("/", hasPermission("Food", "View"), catchAsync(getAllFoods));
router.get("/:id", hasPermission("Food", "View"), catchAsync(getFoodById));
router.put("/:id",
    //  validate(updateFoodSchema), 
    hasPermission("Food", "Edit"), catchAsync(updateFood));
router.delete("/:id", hasPermission("Food", "Delete"), catchAsync(deleteFood));

// Toggle Endpoints
router.put("/variation/:id/status", hasPermission("Food", "Edit"), catchAsync(toggleVariationStatus));
router.put("/option/:id/status", hasPermission("Food", "Edit"), catchAsync(toggleOptionStatus));
router.put("/:id/default", hasPermission("Food", "Edit"), catchAsync(toggleOptionDefault));


export default router;
