import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    checkFirstOrderDiscount,
    getAvailableFirstOrderDiscounts,
} from "../../controllers/user/firstOrderDiscount";
import { validate } from "../../middlewares/validation";
import { checkFirstOrderDiscountQuerySchema } from "../../validation/user/firstOrderDiscount";

const router = Router();

router.get("/check", validate(checkFirstOrderDiscountQuerySchema, "query"), catchAsync(checkFirstOrderDiscount));

router.get("/available", catchAsync(getAvailableFirstOrderDiscounts));

export default router;
