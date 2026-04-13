import { Router } from "express";
import { getAllWallets,getRestaurantWallet,approveWithdrawal,collectCashFromRestaurant,getWalletTransactions } from "../../controllers/admin/restaurant_wallets";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.get("/", catchAsync(getAllWallets));
router.get("/restaurant/:id", catchAsync(getRestaurantWallet));
router.get("/transactions/:restaurantId", catchAsync(getWalletTransactions));
router.put("/approve/:id", catchAsync(approveWithdrawal));
router.put("/collect/:id", catchAsync(collectCashFromRestaurant));
export default router;