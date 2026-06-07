import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    createCoupon,
    getAllCoupons,
    getCouponById,
    updateCoupon,
    deleteCoupon,
    toggleCouponStatus,
    // validateCouponEndpoint,
    getCouponUsages,
} from "../../controllers/admin/coupon";

const router = Router();
``
// Validate a coupon code before placing order
// router.post("/validate", catchAsync(validateCouponEndpoint));

// CRUD
router.post("/", catchAsync(createCoupon));
router.get("/", catchAsync(getAllCoupons));
router.get("/:id", catchAsync(getCouponById));
router.put("/:id", catchAsync(updateCoupon));
router.delete("/:id", catchAsync(deleteCoupon));

// Toggle active/inactive
router.patch("/:id/toggle-status", catchAsync(toggleCouponStatus));

// Usage history for a specific coupon
router.get("/:id/usages", catchAsync(getCouponUsages));

export default router;
