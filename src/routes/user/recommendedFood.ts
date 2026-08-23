import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getRecommendedFoodsForUser } from "../../controllers/user/recommendedFood";

const router = Router();

// ✅ Get active recommended products for a basic food item
router.get("/:foodId", catchAsync(getRecommendedFoodsForUser));

export default router;
