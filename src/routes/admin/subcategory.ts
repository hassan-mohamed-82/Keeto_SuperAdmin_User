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

const router = Router();

router.get("/select", catchAsync(getallcategory));
router.post("/", catchAsync(createSubcategory));
router.get("/", catchAsync(getAllSubcategories));
router.get("/:id", catchAsync(getSubcategoryById));
router.put("/:id", catchAsync(updateSubcategory));
router.delete("/:id", catchAsync(deleteSubcategory));

export default router;
