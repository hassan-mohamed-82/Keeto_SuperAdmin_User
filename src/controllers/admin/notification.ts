import { Request, Response } from "express";
import { db } from "../../models/connection";
import { notifications } from "../../models/schema";
import { eq, and, desc, count } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";
import { NotFound } from "../../Errors/NotFound";

// ==========================================
// 1. Get Admin Notifications
// ==========================================
export const getMyNotifications = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    // Base conditions for this restaurant/branch
    const baseConditions: any[] = [
        eq(notifications.recipientType, "superadmin"),
        eq(notifications.recipientId, "superadmin")
    ];

    // Filter conditions for current page view
    const filteredConditions = [...baseConditions];
    const isReadParam = req.query.isRead as string | undefined;
    const unreadOnlyParam = req.query.unreadOnly as string | undefined;

    if (isReadParam === "false" || unreadOnlyParam === "true") {
        filteredConditions.push(eq(notifications.isRead, false));
    } else if (isReadParam === "true") {
        filteredConditions.push(eq(notifications.isRead, true));
    } else if (req.query.all !== "true") {
        filteredConditions.push(eq(notifications.isRead, false));
    }

    // 🚀 Execute list query, total filtered count, and total unread count in parallel
    const [restaurantNotifications, totalCountResult, unreadCountResult] = await Promise.all([
        db
            .select()
            .from(notifications)
            .where(and(...filteredConditions))
            .orderBy(desc(notifications.createdAt))
            .limit(limit)
            .offset(offset),
        
        db
            .select({ count: count() })
            .from(notifications)
            .where(and(...filteredConditions)),
            
        db
            .select({ count: count() })
            .from(notifications)
            .where(and(...baseConditions, eq(notifications.isRead, false)))
    ]);

    const totalCount = Number(totalCountResult[0]?.count || 0);
    const unreadCount = Number(unreadCountResult[0]?.count || 0);

    // Format output
    const formattedNotifications = restaurantNotifications.map((notif) => {
        let parsedData = null;
        if (notif.data) {
            try {
                parsedData = typeof notif.data === "string" ? JSON.parse(notif.data) : notif.data;
            } catch (error) {
                parsedData = notif.data;
            }
        }

        return {
            ...notif,
            data: parsedData,
        };
    });

    return SuccessResponse(res, {
        message: "Notifications fetched successfully",
        data: formattedNotifications,
        pagination: {
            page,
            limit,
            totalItems: totalCount,
            totalPages: Math.ceil(totalCount / limit),
            unreadCount, // Useful for header badge counters
        }
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
