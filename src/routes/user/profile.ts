import { Router } from "express";
import { getProfile, updateProfile } from "../../controllers/user/profile";
import { authenticated } from "../../middlewares/authenticated";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();

router.get("/", authenticated, catchAsync(getProfile));
router.put("/", authenticated, catchAsync(updateProfile));

export default router;
