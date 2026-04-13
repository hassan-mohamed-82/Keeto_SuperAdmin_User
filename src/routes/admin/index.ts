import { Router } from "express";
import AdmiRouter from "./admin";
import authRouter from "./auth";
import RolesRouter from "./roles";
import CountryRouter from "./country";
import CityRouter from "./city";
import ZoneRouter from "./zone";
import CuisineRouter from "./Cuisine ";
import CategoryRouter from "./Category";
import SubcategoryRouter from "./subcategory";
import AdonecategoryRouter from "./adonescategory";
import AddonRouter from "./addon";
import RestaurantRouter from "./restaurants";
import FoodRouter from "./food";
import BasiccampaignRouter from "./Basiccampaign";
import walletsRouter from "./restaurant_wallets"
import BussinessplanRouter from "./BusinessPlans";
import restaurantsettingRouter from "./restaurantsetting";
import payment_methodsRouter from "./payment_methods";
import OrderRouter from "./order"
import user_walletsRouter from "./userWallets";
import zoneDeliveryFeesRouter from "./zoneDeliveryFees";
import { authenticated } from "../../middlewares/authenticated";
import { authorizeRoles } from "../../middlewares/authorized";
const router = Router();

router.use("/auth", authRouter);
router.use(authenticated, authorizeRoles("superadmin", "admin"));

router.use("/admin", AdmiRouter);
router.use("/roles", RolesRouter);
router.use("/countries", CountryRouter);
router.use("/cities", CityRouter);
router.use("/zones", ZoneRouter);
router.use("/cuisines", CuisineRouter);
router.use("/categories", CategoryRouter);
router.use("/subcategories", SubcategoryRouter);
router.use("/order", OrderRouter);
router.use("/adonescategory", AdonecategoryRouter);
router.use("/restaurants", RestaurantRouter);
router.use("/addons", AddonRouter);
router.use("/food", FoodRouter);
router.use("/businessplans", BussinessplanRouter);
router.use("/basiccampaign", BasiccampaignRouter);
router.use("/wallets", walletsRouter);
router.use("/restaurantsetting", restaurantsettingRouter);
router.use("/payment-methods", payment_methodsRouter);
router.use("/user-wallets", user_walletsRouter);
router.use("/zone-delivery-fees", zoneDeliveryFeesRouter);

export default router;