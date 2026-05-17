import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  createCuisine,
  getAllCuisines,
  getCuisineById,
  updateCuisine,
  deleteCuisine,
} from "../../controllers/admin/Cuisine ";
import { validate } from "../../middlewares/validation";
import { createCuisineSchema, updateCuisineSchema } from "../../validation/admin/Cuisine ";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.post("/",
  // validate(createCuisineSchema), 
  hasPermission("cuisines", "Add"), catchAsync(createCuisine));
router.get("/", hasPermission("cuisines", "View"), catchAsync(getAllCuisines));
router.get("/:id", hasPermission("cuisines", "View"), catchAsync(getCuisineById));
router.put("/:id", 
  // validate(updateCuisineSchema), 
  hasPermission("cuisines", "Edit"), catchAsync(updateCuisine));
router.delete("/:id", hasPermission("cuisines", "Delete"), catchAsync(deleteCuisine));

export default router;
