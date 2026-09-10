import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { getUserStatsParamsSchema } from "../../validation/admin/user";
import {
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser,
    getBlockedUsers,
    toggleRestaurantUserBlock,
    getUserStats,
} from "../../controllers/admin/Keeto_users";

const router = Router();

router.get("/blocked", catchAsync(getBlockedUsers));
router.post("/restaurant-block", catchAsync(toggleRestaurantUserBlock));
router.get("/", catchAsync(getAllUsers));
router.get("/:id/stats", validate(getUserStatsParamsSchema, "params"), catchAsync(getUserStats));
router.get("/:id", catchAsync(getUserById));
router.put("/:id", catchAsync(updateUser));
router.delete("/:id", catchAsync(deleteUser));

export default router;


