import { mysqlTable, char, int, timestamp, uniqueIndex, mysqlEnum, varchar, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "./Users";
import { restaurants } from "../admin/restaurants";
import { orders } from "../admin/order";

export const userRestaurantPoints = mysqlTable("user_restaurant_points", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    userId: char("user_id", { length: 36 })
        .references(() => users.id, { onDelete: "cascade" })
        .notNull(),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),

    points: int("points").default(0).notNull(),
    totalOrders: int("total_orders").default(0).notNull(),

    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (table) => ({
    userRestIdx: uniqueIndex("unique_user_restaurant_points").on(table.userId, table.restaurantId),
}));

export const userPointsTransactions = mysqlTable("user_points_transactions", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    userId: char("user_id", { length: 36 })
        .references(() => users.id, { onDelete: "cascade" })
        .notNull(),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),

    type: mysqlEnum("type", [
        "earn",          // كسب نقاط عند استلام الطلب
        "redeem",        // استبدال نقاط بوجبة
        "manual_adjust"  // تعديل يدوي من الإدارة
    ]).notNull(),

    points: int("points").notNull(),

    balanceBefore: int("balance_before").notNull(),

    balanceAfter: int("balance_after").notNull(),

    orderId: char("order_id", { length: 36 })
        .references(() => orders.id, { onDelete: "set null" }),

    note: varchar("note", { length: 255 }),

    createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
    userIdx: index("user_points_tx_user_idx").on(table.userId),
    restIdx: index("user_points_tx_rest_idx").on(table.restaurantId),
}));