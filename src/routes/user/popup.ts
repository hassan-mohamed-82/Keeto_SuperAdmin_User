import { Router } from "express";
import { getActivePopups, getPopupById } from "../../controllers/user/popup";
import { catchAsync } from "../../utils/catchAsync";

const router = Router();

router.get("/:restaurantId", catchAsync(getActivePopups));
router.get("/:restaurantId/:id", catchAsync(getPopupById));

export default router;
