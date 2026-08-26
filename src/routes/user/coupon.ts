// src/routes/user/coupon.ts
import { Router } from "express";
import { checkCoupon, getAvailableCoupons } from "../../controllers/user/coupon";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.post("/check", catchAsync(checkCoupon));
router.get("/available", catchAsync(getAvailableCoupons));

export default router;
