import { Router } from "express";
import { approveWalletTransaction, rejectWalletTransaction } from "../../controllers/admin/user_wallet";
import { catchAsync } from "../../utils/catchAsync";
import { hasPermission } from "../../middlewares/";
const router = Router();
router.put("/approve/:transactionId", hasPermission("UserWallet", "Edit"), catchAsync(approveWalletTransaction));
router.put("/reject/:transactionId", hasPermission("UserWallet", "Edit"), catchAsync(rejectWalletTransaction));
export default router;
