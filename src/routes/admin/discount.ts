import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    createDiscountByAdmin,
    getAllDiscountsByAdmin,
    getDiscountByIdByAdmin,
    updateDiscountByAdmin,
    deleteDiscountByAdmin,
    toggleDiscountStatusByAdmin,
} from "../../controllers/admin/discount";
import { validate } from "../../middlewares/validation";
import { createDiscountSchema, updateDiscountSchema } from "../../validation/admin/discount";
import { hasPermission } from "../../middlewares/";

const router = Router();

// Create discount
router.post("/", validate(createDiscountSchema), hasPermission("Discounts", "Add"), catchAsync(createDiscountByAdmin));

// Get all discounts
router.get("/", hasPermission("Discounts", "View"), catchAsync(getAllDiscountsByAdmin));

// Get discount by ID
router.get("/:id", hasPermission("Discounts", "View"), catchAsync(getDiscountByIdByAdmin));

// Update discount
router.put("/:id", validate(updateDiscountSchema), hasPermission("Discounts", "Edit"), catchAsync(updateDiscountByAdmin));

// Delete discount
router.delete("/:id", hasPermission("Discounts", "Delete"), catchAsync(deleteDiscountByAdmin));

// Toggle active status
router.patch("/:id/toggle-status", hasPermission("Discounts", "Status"), catchAsync(toggleDiscountStatusByAdmin));

export default router;
