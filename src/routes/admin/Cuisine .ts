import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
  createCuisine,
  getAllCuisines,
  getCuisineById,
  updateCuisine,
  deleteCuisine,
} from "../../controllers/admin/Cuisine ";

const router = Router();

router.post("/", catchAsync(createCuisine));
router.get("/", catchAsync(getAllCuisines));
router.get("/:id", catchAsync(getCuisineById));
router.put("/:id", catchAsync(updateCuisine));
router.delete("/:id", catchAsync(deleteCuisine));

export default router;
