"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.users = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.users = (0, mysql_core_1.mysqlTable)("users", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    photo: (0, mysql_core_1.varchar)("photo", { length: 500 }),
    email: (0, mysql_core_1.varchar)("email", { length: 255 }).notNull().unique(),
    phone: (0, mysql_core_1.varchar)("phone", { length: 20 }).notNull(),
    fcmToken: (0, mysql_core_1.text)("fcm_token"),
    password: (0, mysql_core_1.varchar)("password", { length: 255 }).notNull(),
    isVerified: (0, mysql_core_1.boolean)("is_verified").default(false),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
