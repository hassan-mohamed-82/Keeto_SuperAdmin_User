"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sales = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.sales = (0, mysql_core_1.mysqlTable)("sales", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    phone: (0, mysql_core_1.varchar)("phone", { length: 50 }),
    email: (0, mysql_core_1.varchar)("email", { length: 255 }),
    // البوينتس الخاصة بمندوب المبيعات
    points: (0, mysql_core_1.int)("points").default(0),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
