"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markAllNotificationsAsRead = exports.markNotificationAsRead = exports.getMyNotifications = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const NotFound_1 = require("../../Errors/NotFound");
// ==========================================
// 1. Get Admin Notifications
// ==========================================
const getMyNotifications = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    // Base conditions for this restaurant/branch
    const baseConditions = [
        (0, drizzle_orm_1.eq)(schema_1.notifications.recipientType, "superadmin"),
        (0, drizzle_orm_1.eq)(schema_1.notifications.recipientId, "superadmin")
    ];
    // Filter conditions for current page view
    const filteredConditions = [...baseConditions];
    const isReadParam = req.query.isRead;
    const unreadOnlyParam = req.query.unreadOnly;
    if (isReadParam === "false" || unreadOnlyParam === "true") {
        filteredConditions.push((0, drizzle_orm_1.eq)(schema_1.notifications.isRead, false));
    }
    else if (isReadParam === "true") {
        filteredConditions.push((0, drizzle_orm_1.eq)(schema_1.notifications.isRead, true));
    }
    else if (req.query.all !== "true") {
        filteredConditions.push((0, drizzle_orm_1.eq)(schema_1.notifications.isRead, false));
    }
    // 🚀 Execute list query, total filtered count, and total unread count in parallel
    const [restaurantNotifications, totalCountResult, unreadCountResult] = await Promise.all([
        connection_1.db
            .select()
            .from(schema_1.notifications)
            .where((0, drizzle_orm_1.and)(...filteredConditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.notifications.createdAt))
            .limit(limit)
            .offset(offset),
        connection_1.db
            .select({ count: (0, drizzle_orm_1.count)() })
            .from(schema_1.notifications)
            .where((0, drizzle_orm_1.and)(...filteredConditions)),
        connection_1.db
            .select({ count: (0, drizzle_orm_1.count)() })
            .from(schema_1.notifications)
            .where((0, drizzle_orm_1.and)(...baseConditions, (0, drizzle_orm_1.eq)(schema_1.notifications.isRead, false)))
    ]);
    const totalCount = Number(totalCountResult[0]?.count || 0);
    const unreadCount = Number(unreadCountResult[0]?.count || 0);
    // Format output
    const formattedNotifications = restaurantNotifications.map((notif) => {
        let parsedData = null;
        if (notif.data) {
            try {
                parsedData = typeof notif.data === "string" ? JSON.parse(notif.data) : notif.data;
            }
            catch (error) {
                parsedData = notif.data;
            }
        }
        return {
            ...notif,
            data: parsedData,
        };
    });
    return (0, response_1.SuccessResponse)(res, {
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
exports.getMyNotifications = getMyNotifications;
// ==========================================
// 2. Mark Notification as Read
// ==========================================
const markNotificationAsRead = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const { id } = req.params;
    const [notification] = await connection_1.db
        .select()
        .from(schema_1.notifications)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.notifications.id, id), (0, drizzle_orm_1.eq)(schema_1.notifications.recipientType, "superadmin")))
        .limit(1);
    if (!notification)
        throw new NotFound_1.NotFound("Notification not found");
    await connection_1.db.update(schema_1.notifications)
        .set({ isRead: true })
        .where((0, drizzle_orm_1.eq)(schema_1.notifications.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "Notification marked as read" });
};
exports.markNotificationAsRead = markNotificationAsRead;
// ==========================================
// 3. Mark All Notifications as Read
// ==========================================
const markAllNotificationsAsRead = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    await connection_1.db.update(schema_1.notifications)
        .set({ isRead: true })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.notifications.recipientType, "superadmin"), (0, drizzle_orm_1.eq)(schema_1.notifications.recipientId, "superadmin"), (0, drizzle_orm_1.eq)(schema_1.notifications.isRead, false)));
    return (0, response_1.SuccessResponse)(res, { message: "All notifications marked as read" });
};
exports.markAllNotificationsAsRead = markAllNotificationsAsRead;
