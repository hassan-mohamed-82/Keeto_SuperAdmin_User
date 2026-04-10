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
import BussinessplanRouter from "./BusinessPlans";
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
router.use("/adonescategory", AdonecategoryRouter);
router.use("/restaurants", RestaurantRouter);
router.use("/addons", AddonRouter);
router.use("/food", FoodRouter);
router.use("/businessplans", BussinessplanRouter);
router.use("/basiccampaign", BasiccampaignRouter);

export default router;    