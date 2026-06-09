import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser
} from "../../controllers/admin/Keeto_users";

const router = Router();

router.get("/", catchAsync(getAllUsers));
router.get("/:id", catchAsync(getUserById));
router.put("/:id", catchAsync(updateUser));
router.delete("/:id", catchAsync(deleteUser));

export default router;
