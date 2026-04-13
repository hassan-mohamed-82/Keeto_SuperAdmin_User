import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { addFundToWallet,getWalletHistory } from "../../controllers/user/userWallets";
const router = Router();

router.post("/add-fund", catchAsync(addFundToWallet));
router.get("/history", catchAsync(getWalletHistory));

export default router;