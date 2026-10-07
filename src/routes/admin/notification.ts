import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { getMyNotifications, markNotificationAsRead, markAllNotificationsAsRead } from "../../controllers/admin/notification";
import { hasPermission } from "../../middlewares";

const router = Router();

router.get("/", hasPermission("Notifications", "View"), catchAsync(getMyNotifications));
router.put("/read-all", hasPermission("Notifications", "Edit"), catchAsync(markAllNotificationsAsRead));
router.put("/:id/read", hasPermission("Notifications", "Edit"), catchAsync(markNotificationAsRead));

export default router;
