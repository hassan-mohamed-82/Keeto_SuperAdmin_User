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

const router = Router();

router.post("/", catchAsync(createPopup));
router.get("/", catchAsync(getAllPopups));
router.get("/:id", catchAsync(getPopupById));
router.put("/:id", catchAsync(updatePopup));
router.delete("/:id", catchAsync(deletePopup));
router.put("/:id/status", catchAsync(updatePopupStatus));

export default router;
