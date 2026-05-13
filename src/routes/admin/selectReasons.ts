import { Router } from "express";
import { createReason, getAllReasons, getReasonById, updateReason, deleteReason } from "../../controllers/admin/selectReasons";
import { catchAsync } from "../../utils/catchAsync";
import { validate } from "../../middlewares/validation";
import { createSelectReasonSchema,updateSelectReasonSchema } from "../../validation/admin/selectReasons";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.post("/", hasPermission("Reasons", "Add"), validate(createSelectReasonSchema), catchAsync(createReason));
router.get("/", hasPermission("Reasons", "View"), catchAsync(getAllReasons));
router.get("/:id", hasPermission("Reasons", "View"), catchAsync(getReasonById));
router.put("/:id", hasPermission("Reasons", "Edit"), validate(updateSelectReasonSchema), catchAsync(updateReason));
router.delete("/:id", hasPermission("Reasons", "Delete"), catchAsync(deleteReason));

export default router;