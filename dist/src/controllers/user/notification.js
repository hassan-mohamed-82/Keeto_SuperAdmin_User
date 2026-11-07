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
// 1. Get User Notifications
// ==========================================
const getMyNotifications = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    // Optional restaurantId filter from query string
    // e.g. GET /user/notifications?restaurantId=uuid-xxx
    const restaurantId = req.query.restaurantId;
    // Build conditions
    const conditions = [
        (0, drizzle_orm_1.eq)(schema_1.notifications.recipientType, "user"),
        (0, drizzle_orm_1.eq)(schema_1.notifications.recipientId, userId),
    ];
    if (restaurantId) {
        // Filter by restaurantId stored inside the JSON data column
        conditions.push((0, drizzle_orm_1.sql) `JSON_UNQUOTE(JSON_EXTRACT(${schema_1.notifications.data}, '$.restaurantId')) = ${restaurantId}`);
    }
    const [userNotifications, totalResult] = await Promise.all([
        connection_1.db
            .select()
            .from(schema_1.notifications)
            .where((0, drizzle_orm_1.and)(...conditions))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.notifications.createdAt))
            .limit(limit)
            .offset(offset),
        connection_1.db
            .select({ count: (0, drizzle_orm_1.count)() })
            .from(schema_1.notifications)
            .where((0, drizzle_orm_1.and)(...conditions)),
    ]);
    const totalItems = Number(totalResult[0]?.count ?? 0);
    return (0, response_1.SuccessResponse)(res, {
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
exports.getMyNotifications = getMyNotifications;
// ==========================================
// 2. Mark Notification as Read
// ==========================================
const markNotificationAsRead = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { id } = req.params;
    const [notification] = await connection_1.db
        .select()
        .from(schema_1.notifications)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.notifications.id, id), (0, drizzle_orm_1.eq)(schema_1.notifications.recipientType, "user"), (0, drizzle_orm_1.eq)(schema_1.notifications.recipientId, userId)))
        .limit(1);
    if (!notification)
        throw new NotFound_1.NotFound("Notification not found");
    await connection_1.db.update(schema_1.notifications)
        .set({ isRead: true })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.notifications.id, id), (0, drizzle_orm_1.eq)(schema_1.notifications.recipientType, "user"), (0, drizzle_orm_1.eq)(schema_1.notifications.recipientId, userId)));
    return (0, response_1.SuccessResponse)(res, { message: "Notification marked as read" });
};
exports.markNotificationAsRead = markNotificationAsRead;
// ==========================================
// 3. Mark All Notifications as Read
// ==========================================
const markAllNotificationsAsRead = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    await connection_1.db.update(schema_1.notifications)
        .set({ isRead: true })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.notifications.recipientType, "user"), (0, drizzle_orm_1.eq)(schema_1.notifications.recipientId, userId), (0, drizzle_orm_1.eq)(schema_1.notifications.isRead, false)));
    return (0, response_1.SuccessResponse)(res, { message: "All notifications marked as read" });
};
exports.markAllNotificationsAsRead = markAllNotificationsAsRead;
