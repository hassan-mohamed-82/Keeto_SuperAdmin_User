import { Router } from "express";
import { createAdmin, deleteAdmin, toggleAdminStatus,
    getAllAdmins, getAdminById, updateAdmin } from "../../controllers/admin/admin";
import { catchAsync } from "../../utils/catchAsync";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.post("/", hasPermission("Admins", "Add"), catchAsync(createAdmin));
router.get("/", hasPermission("Admins", "View"), catchAsync(getAllAdmins));
router.get("/:id", hasPermission("Admins", "View"), catchAsync(getAdminById));
router.put("/:id", hasPermission("Admins", "Edit"), catchAsync(updateAdmin));
router.patch("/:id", hasPermission("Admins", "Status"), catchAsync(toggleAdminStatus));
router.delete("/:id", hasPermission("Admins", "Delete"), catchAsync(deleteAdmin));

export default router;