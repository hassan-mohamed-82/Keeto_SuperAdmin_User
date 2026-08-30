import { Router } from "express";
import authRouter from "./auth";
import orderRouter from "./order";
import homeRouter from "./home";
import profileRouter from "./profile";
import notificationRouter from "./notification";
import cartRouter from "./cart";
import user_walletsRouter from "./user_wallets";
import addressRouter from "./address";
import { authenticated } from "../../middlewares/authenticated";
import { authorizeRoles } from "../../middlewares/authorized";
import favlistRouter from "./favlist";
import restaurantFeaturesRouter from "./restaurantFeatures";
import ratingRouter from "./rating";
import SocialMediaRouter from "./SocialMedia";
import sliderRouter from "./slider";
import imageRouter from "./image";
import offersRouter from "./offers";
import landingPageRouter from "./landingPage";
import pointsRouter from "./userPoints";
import restaurantSettingsRouter from "./restaurantSettings";
import recommendedFoodRouter from "./recommendedFood"
import policyRouter from "./policyRouter";
import popupRouter from "./popup";
import couponRouter from "./coupon";

const router = Router();

router.use("/home", homeRouter);
router.use("/auth", authRouter);
router.use("/socialmedia", SocialMediaRouter);
router.use("/slider", sliderRouter);
router.use("/image", imageRouter);
router.use("/rating", ratingRouter);
router.use("/landing-page" , landingPageRouter)
router.use("/settings",restaurantSettingsRouter)
router.use("/recommended-foods", recommendedFoodRouter);
router.use("/policy",policyRouter)
router.use("/popup", popupRouter);
router.use("/offers", offersRouter);

router.use("/restaurants", restaurantFeaturesRouter);
router.use(authenticated,authorizeRoles("user"));
router.use("/profile", profileRouter);
router.use("/order", orderRouter);
router.use("/wallet",user_walletsRouter);
router.use("/address", addressRouter);
router.use("/cart", cartRouter);
router.use("/favlist", favlistRouter);
router.use("/notifications", notificationRouter);
router.use("/points", pointsRouter);
router.use("/coupon", couponRouter);
export default router;