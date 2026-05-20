import { Request, Response } from "express";
import { db } from "../../models/connection";
import { notifications } from "../../models/schema";
import { eq, and, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";
import { NotFound } from "../../Errors/NotFound";
import { BadRequest } from "../../Errors/BadRequest";

// ==========================================
// 1. Get User Notifications
// ==========================================
export const getMyNotifications = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;

    // Pagination (optional)
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const userNotifications = await db
        .select()
        .from(notifications)
        .where(and(
            eq(notifications.recipientType, "user"),
            eq(notifications.recipientId, userId)
        ))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset);

    return SuccessResponse(res, {
        message: "Notifications fetched successfully",
        data: userNotifications,
        page,
        limit
    });
};

// ==========================================
// 2. Mark Notification as Read
// ==========================================
export const markNotificationAsRead = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { id } = req.params;

    const [notification] = await db
        .select()
        .from(notifications)
        .where(and(
            eq(notifications.id, id),
            eq(notifications.recipientId, userId)
        ))
        .limit(1);

    if (!notification) throw new NotFound("Notification not found");

    await db.update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, id));

    return SuccessResponse(res, { message: "Notification marked as read" });
};

// ==========================================
// 3. Mark All Notifications as Read
// ==========================================
export const markAllNotificationsAsRead = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;

    await db.update(notifications)
        .set({ isRead: true })
        .where(and(
            eq(notifications.recipientType, "user"),
            eq(notifications.recipientId, userId),
            eq(notifications.isRead, false)
        ));

    return SuccessResponse(res, { message: "All notifications marked as read" });
};
