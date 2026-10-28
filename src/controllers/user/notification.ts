import { Request, Response } from "express";
import { db } from "../../models/connection";
import { notifications } from "../../models/schema";
import { eq, and, desc, sql, count } from "drizzle-orm";
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

    // Pagination
    const page   = parseInt(req.query.page  as string) || 1;
    const limit  = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    // Optional restaurantId filter from query string
    // e.g. GET /user/notifications?restaurantId=uuid-xxx
    const restaurantId = req.query.restaurantId as string | undefined;

    // Build conditions
    const conditions: any[] = [
        eq(notifications.recipientType, "user"),
        eq(notifications.recipientId,   userId),
    ];

    if (restaurantId) {
        // Filter by restaurantId stored inside the JSON data column
        conditions.push(
            sql`JSON_UNQUOTE(JSON_EXTRACT(${notifications.data}, '$.restaurantId')) = ${restaurantId}`
        );
    }

    const [userNotifications, totalResult] = await Promise.all([
        db
            .select()
            .from(notifications)
            .where(and(...conditions))
            .orderBy(desc(notifications.createdAt))
            .limit(limit)
            .offset(offset),

        db
            .select({ count: count() })
            .from(notifications)
            .where(and(...conditions)),
    ]);

    const totalItems = Number(totalResult[0]?.count ?? 0);

    return SuccessResponse(res, {
        message: "Notifications fetched successfully",
        data: userNotifications,
        pagination: {
            page,
            limit,
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
        },
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
            eq(notifications.recipientType, "user"),
            eq(notifications.recipientId, userId)
        ))
        .limit(1);

    if (!notification) throw new NotFound("Notification not found");

    await db.update(notifications)
        .set({ isRead: true })
        .where(and(
            eq(notifications.id, id),
            eq(notifications.recipientType, "user"),
            eq(notifications.recipientId, userId)
        ));

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
