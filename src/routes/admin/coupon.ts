import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    createCoupon,
    getAllCoupons,
    getCouponById,
    updateCoupon,
    deleteCoupon,
    toggleCouponStatus,
    getCouponUsages,
} from "../../controllers/admin/coupon";
import { validate } from "../../middlewares/validation";
import {
    createCouponSchema,
    updateCouponSchema,
} from "../../validation/admin/coupon";

const router = Router();

// CRUD
router.post("/", validate(createCouponSchema), catchAsync(createCoupon));
router.get("/", catchAsync(getAllCoupons));
router.get("/:id", catchAsync(getCouponById));
router.put("/:id", validate(updateCouponSchema), catchAsync(updateCoupon));
router.delete("/:id", catchAsync(deleteCoupon));

// Toggle active/inactive
router.patch("/:id/toggle-status", catchAsync(toggleCouponStatus));

// Usage history for a specific coupon
router.get("/:id/usages", catchAsync(getCouponUsages));

export default router;
