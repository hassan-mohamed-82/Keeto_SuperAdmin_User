"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ratingRequests = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
const restaurantRating_1 = require("../user/restaurantRating");
const order_1 = require("./order");
exports.ratingRequests = (0, mysql_core_1.mysqlTable)("rating_requests", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .notNull()
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" }),
    // Target: rate on restaurant (restaurant_ratings table) or rate on order (orders table)
    targetType: (0, mysql_core_1.mysqlEnum)("target_type", ["restaurant", "order"]).notNull().default("restaurant"),
    // Reference to restaurant_ratings (if targetType === 'restaurant')
    ratingId: (0, mysql_core_1.char)("rating_id", { length: 36 })
        .references(() => restaurantRating_1.restaurantRatings.id, { onDelete: "cascade" }),
    // Reference to orders (if targetType === 'order')
    orderId: (0, mysql_core_1.char)("order_id", { length: 36 })
        .references(() => order_1.orders.id, { onDelete: "cascade" }),
    // Action requested: edit or delete
    requestType: (0, mysql_core_1.mysqlEnum)("request_type", ["edit", "delete"]).notNull(),
    // In case of edit, proposed changes:
    newRating: (0, mysql_core_1.int)("new_rating"),
    newComment: (0, mysql_core_1.text)("new_comment"),
    // Reason provided by the restaurant
    reason: (0, mysql_core_1.text)("reason").notNull(),
    // Status of request
    status: (0, mysql_core_1.mysqlEnum)("status", ["pending", "approved", "rejected"]).notNull().default("pending"),
    // Response / notes from SuperAdmin
    adminNotes: (0, mysql_core_1.text)("admin_notes"),
    resolvedAt: (0, mysql_core_1.timestamp)("resolved_at"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
