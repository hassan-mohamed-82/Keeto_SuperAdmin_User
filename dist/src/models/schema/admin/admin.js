"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.admins = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const roles_1 = require("./roles");
exports.admins = (0, mysql_core_1.mysqlTable)("admins", {
    id: (0, mysql_core_1.char)("id", { length: 255 }).primaryKey().notNull().default((0, drizzle_orm_1.sql) `(uuid())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    email: (0, mysql_core_1.varchar)("email", { length: 255 }).notNull(),
    type: (0, mysql_core_1.mysqlEnum)("type", ["super_admin", "admin"]).notNull().default("admin"),
    phoneNumber: (0, mysql_core_1.varchar)("phone_number", { length: 255 }).notNull(),
    password: (0, mysql_core_1.varchar)("password", { length: 255 }).notNull(),
    roleId: (0, mysql_core_1.char)("role_id", { length: 36 }).references(() => roles_1.roles.id),
    permissions: (0, mysql_core_1.json)("permissions").$type().default([]),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).notNull().default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow(),
});
