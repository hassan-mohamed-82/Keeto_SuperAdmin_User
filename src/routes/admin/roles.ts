import { Router } from "express";
import { createRole, deleteRole, getAllRoles, getRoleById, updateRole ,getAdminPermissions} from "../../controllers/admin/roles";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { createRoleSchema, updateRoleSchema } from "../../validation/admin/roles";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.get("/permissions", hasPermission("Roles", "View"), catchAsync(getAdminPermissions));

router.post("/", hasPermission("Roles", "Add"), validate(createRoleSchema), catchAsync(createRole));
router.get("/", hasPermission("Roles", "View"), catchAsync(getAllRoles));
router.get("/:id", hasPermission("Roles", "View"), catchAsync(getRoleById));
router.put("/:id", hasPermission("Roles", "Edit"), validate(updateRoleSchema), catchAsync(updateRole));
router.delete("/:id", hasPermission("Roles", "Delete"), catchAsync(deleteRole));

export default router;