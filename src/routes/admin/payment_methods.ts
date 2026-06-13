import { Router } from "express";
import { createPaymentMethod,getPaymentMethods,updatepaymentmethodstatus  } from "../../controllers/admin/payment_methodes";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();

router.post("/", catchAsync(createPaymentMethod));
router.get("/", catchAsync(getPaymentMethods));
router.put("/:id", catchAsync(updatepaymentmethodstatus));

export default router;