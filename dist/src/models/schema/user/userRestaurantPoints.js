"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userPointsTransactions = exports.userRestaurantPoints = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const Users_1 = require("./Users");
const restaurants_1 = require("../admin/restaurants");
const order_1 = require("../admin/order");
exports.userRestaurantPoints = (0, mysql_core_1.mysqlTable)("user_restaurant_points", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id, { onDelete: "cascade" })
        .notNull(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull(),
    points: (0, mysql_core_1.int)("points").default(0).notNull(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
}, (table) => ({
    userRestIdx: (0, mysql_core_1.uniqueIndex)("unique_user_restaurant_points").on(table.userId, table.restaurantId),
}));
exports.userPointsTransactions = (0, mysql_core_1.mysqlTable)("user_points_transactions", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id, { onDelete: "cascade" })
        .notNull(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull(),
    type: (0, mysql_core_1.mysqlEnum)("type", [
        "earn", // كسب نقاط عند استلام الطلب
        "redeem", // استبدال نقاط بوجبة
        "manual_adjust" // تعديل يدوي من الإدارة
    ]).notNull(),
    points: (0, mysql_core_1.int)("points").notNull(),
    balanceBefore: (0, mysql_core_1.int)("balance_before").notNull(),
    balanceAfter: (0, mysql_core_1.int)("balance_after").notNull(),
    orderId: (0, mysql_core_1.char)("order_id", { length: 36 })
        .references(() => order_1.orders.id, { onDelete: "set null" }),
    note: (0, mysql_core_1.varchar)("note", { length: 255 }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
}, (table) => ({
    userIdx: (0, mysql_core_1.index)("user_points_tx_user_idx").on(table.userId),
    restIdx: (0, mysql_core_1.index)("user_points_tx_rest_idx").on(table.restaurantId),
}));
