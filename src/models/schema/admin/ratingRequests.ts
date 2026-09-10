import { mysqlTable, char, timestamp, int, text, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { restaurantRatings } from "../user/restaurantRating";
import { orders } from "./order";

export const ratingRequests = mysqlTable("rating_requests", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 })
        .notNull()
        .references(() => restaurants.id, { onDelete: "cascade" }),

    // Target: rate on restaurant (restaurant_ratings table) or rate on order (orders table)
    targetType: mysqlEnum("target_type", ["restaurant", "order"]).notNull().default("restaurant"),

    // Reference to restaurant_ratings (if targetType === 'restaurant')
    ratingId: char("rating_id", { length: 36 })
        .references(() => restaurantRatings.id, { onDelete: "cascade" }),

    // Reference to orders (if targetType === 'order')
    orderId: char("order_id", { length: 36 })
        .references(() => orders.id, { onDelete: "cascade" }),

    // Action requested: edit or delete
    requestType: mysqlEnum("request_type", ["edit", "delete"]).notNull(),

    // In case of edit, proposed changes:
    newRating: int("new_rating"),
    newComment: text("new_comment"),

    // Reason provided by the restaurant
    reason: text("reason").notNull(),

    // Status of request
    status: mysqlEnum("status", ["pending", "approved", "rejected"]).notNull().default("pending"),

    // Response / notes from SuperAdmin
    adminNotes: text("admin_notes"),

    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});