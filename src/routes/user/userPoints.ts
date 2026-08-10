import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    generateRedeemCode,
    getRedeemableProducts
} from "../../controllers/user/userPoints";

const router = Router();

router.get("/products/:restaurantId", catchAsync(getRedeemableProducts));
router.post("/redeem/:restaurantId", catchAsync(generateRedeemCode));

export default router;