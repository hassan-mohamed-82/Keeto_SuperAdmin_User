import { Router } from "express";
import { getAllWallets,getRestaurantWallet,approveWithdrawal,collectCashFromRestaurant,getWalletTransactions } from "../../controllers/admin/restaurant_wallets";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { createRestaurantWalletSchema,updateRestaurantWalletSchema,updateWalletTransactionSchema } from "../../validation/admin/restaurant_wallets"; 
import { hasPermission } from "../../middlewares/";
const router = Router();

router.get("/", hasPermission("RestaurantWallets", "View"), catchAsync(getAllWallets));
router.get("/restaurant/:id", hasPermission("RestaurantWallets", "View"), catchAsync(getRestaurantWallet));
router.get("/transactions/:restaurantId", hasPermission("RestaurantWallets", "View"), catchAsync(getWalletTransactions));
router.put("/approve/:id", hasPermission("RestaurantWallets", "Edit"), validate(updateWalletTransactionSchema), catchAsync(approveWithdrawal));
router.put("/collect/:id", hasPermission("RestaurantWallets", "Edit"), catchAsync(collectCashFromRestaurant));
export default router;