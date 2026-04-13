import { Router } from "express";
import { createPaymentMethod,getPaymentMethod,getPaymentMethods ,updatePaymentMethod, deletePaymentMethod } from "../../controllers/admin/payment_methodes";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();

router.post("/", catchAsync(createPaymentMethod));
router.get("/", catchAsync(getPaymentMethods));
router.get("/:id", catchAsync(getPaymentMethod));
router.put("/:id", catchAsync(updatePaymentMethod));
router.delete("/:id", catchAsync(deletePaymentMethod));

export default router;