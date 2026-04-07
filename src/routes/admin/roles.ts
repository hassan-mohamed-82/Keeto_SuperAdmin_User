import { Router } from "express";
import { createRole, deleteRole, getAllRoles, getRoleById, updateRole } from "../../controllers/admin/roles";
import { catchAsync } from "../../utils/catchAsync";
const router = Router();

router.post("/", catchAsync(createRole));
router.get("/", catchAsync(getAllRoles));
router.get("/:id", catchAsync(getRoleById));
router.put("/:id", catchAsync(updateRole));
router.delete("/:id", catchAsync(deleteRole));

export default router;