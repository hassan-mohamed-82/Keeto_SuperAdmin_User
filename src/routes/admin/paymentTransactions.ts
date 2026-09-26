import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { getPaymentTransactionsQuerySchema } from "../../validation/admin/paymentTransactions";
import {
    getPaymentTransactions,
    getPaymentTransactionDetails,
} from "../../controllers/admin/paymentTransactions";
import { hasPermission } from "../../middlewares/hasPermission";

const router = Router();

router.get(
    "/",
    hasPermission("Orders", "View"),
    validate(getPaymentTransactionsQuerySchema, "query"),
    catchAsync(getPaymentTransactions)
);

router.get(
    "/:id",
    hasPermission("Orders", "View"),
    catchAsync(getPaymentTransactionDetails)
);

export default router;
