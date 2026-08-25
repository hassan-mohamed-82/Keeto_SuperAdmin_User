import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getAllPolicy } from "../../controllers/user/policy";

const router = Router();

router.get("/:restaurantId", catchAsync(getAllPolicy));

export default router;
