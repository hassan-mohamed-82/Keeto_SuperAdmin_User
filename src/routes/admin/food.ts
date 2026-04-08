import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    createFood,
    getAllFoods,
    getFoodById,
    updateFood,
    deleteFood,
    getFoodSelectData,
} from "../../controllers/admin/food";

const router = Router();

router.get("/select", catchAsync(getFoodSelectData));
router.post("/", catchAsync(createFood));
router.get("/", catchAsync(getAllFoods));
router.get("/:id", catchAsync(getFoodById));
router.put("/:id", catchAsync(updateFood));
router.delete("/:id", catchAsync(deleteFood));

export default router;
