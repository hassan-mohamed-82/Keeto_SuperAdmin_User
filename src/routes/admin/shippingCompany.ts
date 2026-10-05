import { Router } from "express";
import {
    getEligibleRestaurants,
    createShippingCompany,
    getShippingCompanies,
    getShippingCompanyById,
    updateShippingCompany,
    deleteShippingCompany,
    assignRestaurantsToCompany,
    removeRestaurantFromCompany,
} from "../../controllers/admin/shippingCompany";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import {
    createShippingCompanySchema,
    updateShippingCompanySchema,
    assignRestaurantsSchema,
} from "../../validation/admin/shippingCompany";

const router = Router();

// جلب المطاعم المؤهلة للربط بشركة الشحن (homeDelivery = true & selfDelivery = false)
router.get("/eligible-restaurants", catchAsync(getEligibleRestaurants));

// إدارة شركات الشحن
router.post("/", validate(createShippingCompanySchema), catchAsync(createShippingCompany));
router.get("/", catchAsync(getShippingCompanies));
router.get("/:id", catchAsync(getShippingCompanyById));
router.put("/:id", validate(updateShippingCompanySchema), catchAsync(updateShippingCompany));
router.delete("/:id", catchAsync(deleteShippingCompany));

// إسناد مطاعم لشركة الشحن وفك إسنادها
router.post("/:id/assign-restaurants", validate(assignRestaurantsSchema), catchAsync(assignRestaurantsToCompany));
router.delete("/:id/restaurants/:restaurantId", catchAsync(removeRestaurantFromCompany));

export default router;
