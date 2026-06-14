"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectReasons = void 0;
// models/selectReason.ts
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.selectReasons = (0, mysql_core_1.mysqlTable)("select_reasons", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    type: (0, mysql_core_1.mysqlEnum)("type", ["user", "restaurant"]).notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
