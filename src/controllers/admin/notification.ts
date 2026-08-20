import { Request, Response } from "express";
import { db } from "../../models/connection";
import { notifications } from "../../models/schema";
import { eq, and, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";
import { NotFound } from "../../Errors/NotFound";

// ==========================================
// 1. Get Admin Notifications
// ==========================================
export const getMyNotifications = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    // Pagination (optional)
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    // ✅ عدم إرجاع الإشعارات المقروءة (أو التصفية بحسب isRead / unreadOnly / all)
    const isReadParam = req.query.isRead as string | undefined;
    const unreadOnlyParam = req.query.unreadOnly as string | undefined;
    const conditions = [
        eq(notifications.recipientType, "superadmin"),
        eq(notifications.recipientId, "superadmin")
    ];

    if (isReadParam === "false" || unreadOnlyParam === "true") {
        conditions.push(eq(notifications.isRead, false));
    } else if (isReadParam === "true") {
        conditions.push(eq(notifications.isRead, true));
    } else if (req.query.all !== "true") {
        // افتراضياً: استبعاد الإشعارات المقروءة (عدم إرجاع الإشعار إذا قُرئ)
        conditions.push(eq(notifications.isRead, false));
    }
    const adminNotifications = await db
        .select()
        .from(notifications)
        .where(and(
            ...conditions
        ))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset);

    return SuccessResponse(res, {
        message: "Notifications fetched successfully",
        data: adminNotifications,
        page,
        limit
    });
};

// ==========================================
// 2. Mark Notification as Read
// ==========================================
export const markNotificationAsRead = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const { id } = req.params;

    const [notification] = await db
        .select()
        .from(notifications)
        .where(and(
            eq(notifications.id, id),
            eq(notifications.recipientType, "superadmin")
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

    await db.update(notifications)
        .set({ isRead: true })
        .where(and(
            eq(notifications.recipientType, "superadmin"),
            eq(notifications.recipientId, "superadmin"),
            eq(notifications.isRead, false)
        ));

    return SuccessResponse(res, { message: "All notifications marked as read" });
};
