import { Router } from "express";
import { 
    getAllWallets,
    getRestaurantWallet,
    getDetailedWallet,
    approveWithdrawal,
    collectCashFromRestaurant,
    getWalletTransactions,
    recordSubscription,
    getSystemGatewayRestaurants,
} from "../../controllers/admin/restaurant_wallets";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { 
    createRestaurantWalletSchema,
    updateRestaurantWalletSchema,
    updateWalletTransactionSchema,
    recordSubscriptionSchema,
} from "../../validation/admin/restaurant_wallets"; 
import { hasPermission } from "../../middlewares/";
const router = Router();

router.get("/", hasPermission("RestaurantWallets", "View"), catchAsync(getAllWallets));
router.get("/system", hasPermission("RestaurantWallets", "View"), catchAsync(getSystemGatewayRestaurants));
router.get("/restaurant/:restaurantId", hasPermission("RestaurantWallets", "View"), catchAsync(getRestaurantWallet));
// تفصيل كامل للمحفظة: service fees + commission + الاشتراكات
router.get("/restaurant/:restaurantId/details", hasPermission("RestaurantWallets", "View"), catchAsync(getDetailedWallet));
router.get("/transactions/:restaurantId", hasPermission("RestaurantWallets", "View"), catchAsync(getWalletTransactions));
router.put("/approve/:id", hasPermission("RestaurantWallets", "Edit"), validate(updateWalletTransactionSchema), catchAsync(approveWithdrawal));
router.put("/collect/:id", hasPermission("RestaurantWallets", "Edit"), catchAsync(collectCashFromRestaurant));
// تسجيل اشتراك دوري يدويًا (شهري/ربع سنوي/سنوي) في محفظة المطعم
router.post("/record-subscription", hasPermission("RestaurantWallets", "Add"), validate(recordSubscriptionSchema), catchAsync(recordSubscription));
export default router;