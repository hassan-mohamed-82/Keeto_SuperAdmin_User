import { Router } from "express";
import { createAdone, getAllAdones, getAdoneById, updateAdone, deleteAdone, toggleAdoneStatus } from "../../controllers/admin/adonescategory";
import { validate } from "../../middlewares/validation";
import { createAdonesCategorySchema,updateAdonesCategorySchema } from "../../validation/admin/adonescategory";
import { catchAsync } from "../../utils/catchAsync";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.post("/", validate(createAdonesCategorySchema), hasPermission("AdonesCategories", "Add"), catchAsync(createAdone));
router.get("/", hasPermission("AdonesCategories", "View"), catchAsync(getAllAdones));
router.get("/:id", hasPermission("AdonesCategories", "View"), catchAsync(getAdoneById));
router.put("/:id", validate(updateAdonesCategorySchema), hasPermission("AdonesCategories", "Edit"), catchAsync(updateAdone));
router.delete("/:id", hasPermission("AdonesCategories", "Delete"), catchAsync(deleteAdone));
router.patch("/:id/status", hasPermission("AdonesCategories", "Status"), catchAsync(toggleAdoneStatus));

export default router;