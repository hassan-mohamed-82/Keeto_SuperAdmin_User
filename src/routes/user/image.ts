import { Router } from "express";
import { getImages } from "../../controllers/user/image";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();
router.get("/:resId", catchAsync(getImages));
export default router;
