import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  createSubcategory,
  getAllSubcategories,
  getSubcategoryById,
  updateSubcategory,
  deleteSubcategory,
  getallcategory
} from "../../controllers/admin/subcategory";

import { validate } from "../../middlewares/validation";
import { createSubcategorySchema, updateSubcategorySchema } from "../../validation/admin/subcategory";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.get("/select", catchAsync(getallcategory));
router.post("/", hasPermission("Subcategories", "Add"), validate(createSubcategorySchema), catchAsync(createSubcategory));
router.get("/", hasPermission("Subcategories", "View"), catchAsync(getAllSubcategories));
router.get("/:id", hasPermission("Subcategories", "View"), catchAsync(getSubcategoryById));
router.put("/:id", hasPermission("Subcategories", "Edit"), validate(updateSubcategorySchema), catchAsync(updateSubcategory));
router.delete("/:id", hasPermission("Subcategories", "Delete"), catchAsync(deleteSubcategory));

export default router;
