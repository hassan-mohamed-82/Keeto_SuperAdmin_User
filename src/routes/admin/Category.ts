import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from "../../controllers/admin/Category";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.post("/", hasPermission("Categories", "Add"), catchAsync(createCategory));
router.get("/", hasPermission("Categories", "View"), catchAsync(getAllCategories));
router.get("/:id", hasPermission("Categories", "View"), catchAsync(getCategoryById));
router.put("/:id", hasPermission("Categories", "Edit"), catchAsync(updateCategory));
router.delete("/:id", hasPermission("Categories", "Delete"), catchAsync(deleteCategory));

export default router;
