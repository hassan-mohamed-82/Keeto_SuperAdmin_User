import { Router } from "express";
import { getSocialMedia } from "../../controllers/user/SocialMedia";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();
router.get("/:resId", catchAsync(getSocialMedia));
export default router;