import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    generateRedeemCode,
    getRedeemableProducts
} from "../../controllers/user/userPoints";

const router = Router();

router.get("/products", catchAsync(getRedeemableProducts));
router.post("/redeem", catchAsync(generateRedeemCode));

export default router;