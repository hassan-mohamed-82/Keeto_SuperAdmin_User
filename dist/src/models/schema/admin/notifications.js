"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifications = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.notifications = (0, mysql_core_1.mysqlTable)("notifications", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    recipientType: (0, mysql_core_1.mysqlEnum)("recipient_type", ["user", "restaurant"]).notNull(),
    // ID of the user OR the restaurant, depending on recipientType
    recipientId: (0, mysql_core_1.char)("recipient_id", { length: 36 }).notNull(),
    title: (0, mysql_core_1.varchar)("title", { length: 255 }).notNull(),
    body: (0, mysql_core_1.text)("body").notNull(),
    // Additional payload data (e.g. orderId, status)
    data: (0, mysql_core_1.json)("data"),
    isRead: (0, mysql_core_1.boolean)("is_read").default(false),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
