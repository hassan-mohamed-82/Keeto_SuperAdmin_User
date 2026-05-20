import { Router } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { 
    getMyNotifications, 
    markNotificationAsRead, 
    markAllNotificationsAsRead 
} from "../../controllers/user/notification";

const router = Router();

router.get("/", catchAsync(getMyNotifications));
router.put("/read-all", catchAsync(markAllNotificationsAsRead));
router.put("/:id/read", catchAsync(markNotificationAsRead));

export default router;
