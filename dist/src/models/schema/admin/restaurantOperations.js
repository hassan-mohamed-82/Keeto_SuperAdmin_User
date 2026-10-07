"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurantOperations = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const mysql_core_1 = require("drizzle-orm/mysql-core");
const restaurants_1 = require("./restaurants");
exports.restaurantOperations = (0, mysql_core_1.mysqlTable)("restaurant_operations", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .notNull()
        .unique()
        .references(() => restaurants_1.restaurants.id),
    operationType: (0, mysql_core_1.mysqlEnum)("operation_type", ["callcenter", "branch"])
        .notNull()
        .default("callcenter"),
    status: (0, mysql_core_1.mysqlEnum)("status", [
        "demo",
        "sales",
        "data",
        "customer support",
        "visit",
        "start order",
        "qr",
        "points",
        "social media",
    ]),
    app: (0, mysql_core_1.mysqlEnum)("app", ["on", "off"]),
    notes: (0, mysql_core_1.json)("notes").$type().notNull().default([]),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
