import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from "../../controllers/admin/Category";

const router = Router();

router.post("/", catchAsync(createCategory));
router.get("/", catchAsync(getAllCategories));
router.get("/:id", catchAsync(getCategoryById));
router.put("/:id", catchAsync(updateCategory));
router.delete("/:id", catchAsync(deleteCategory));

export default router;
