import { Router } from "express";
import {
    createPopup,
    getAllPopups,
    getPopupById,
    updatePopup,
    deletePopup,
    updatePopupStatus,
} from "../../controllers/admin/popup";
import { catchAsync } from "../../utils/catchAsync";
import { hasPermission } from "../../middlewares/";
const router = Router();

router.post("/", hasPermission("popup", "Add"), catchAsync(createPopup));
router.get("/", hasPermission("popup", "View"), catchAsync(getAllPopups));
router.get("/:id", hasPermission("popup", "View"), catchAsync(getPopupById));
router.put("/:id", hasPermission("popup", "Edit"), catchAsync(updatePopup));
router.delete("/:id", hasPermission("popup", "Delete"), catchAsync(deletePopup));
router.put("/:id/status", hasPermission("popup", "Edit"), catchAsync(updatePopupStatus));

export default router;
