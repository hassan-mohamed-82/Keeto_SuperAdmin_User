import { Router } from "express";
import { validate } from "../../middlewares/validation";
import { updateProfileSchema } from "../../validation/user/profile";
import { getProfile, updateProfile, changepassword, deleteAccount, getRestaurantPoints } from "../../controllers/user/profile";
import { authenticated } from "../../middlewares/authenticated";
import { catchAsync } from "../../utils/catchAsync";
import { updateFcmToken } from "../../controllers/user/fcmToken";
const router = Router();

router.get("/", authenticated, catchAsync(getProfile));
router.put("/", authenticated, validate(updateProfileSchema), catchAsync(updateProfile));
router.delete("/", authenticated, catchAsync(deleteAccount));
router.put("/fcm-token", authenticated, catchAsync(updateFcmToken));
router.put("/cahange",authenticated,catchAsync(changepassword))
router.get("/points/:restaurantId", authenticated, catchAsync(getRestaurantPoints));
export default router;
