import { Router } from "express";
import { getSliders } from "../../controllers/user/slider";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();
router.get("/:resId", catchAsync(getSliders));
export default router;
