import { Router } from "express";
import { approveWalletTransaction, rejectWalletTransaction } from "../../controllers/admin/user_wallet";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();
router.put("/approve/:transactionId", catchAsync(approveWalletTransaction));
router.put("/reject/:transactionId", catchAsync(rejectWalletTransaction));
export default router;
