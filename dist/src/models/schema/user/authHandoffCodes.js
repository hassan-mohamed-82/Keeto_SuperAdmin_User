"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authHandoffCodes = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const Users_1 = require("./Users");
exports.authHandoffCodes = (0, mysql_core_1.mysqlTable)("auth_handoff_codes", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    codeHash: (0, mysql_core_1.varchar)("code_hash", { length: 64 }).notNull().unique(),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .notNull()
        .references(() => Users_1.users.id, { onDelete: "cascade" }),
    returnHost: (0, mysql_core_1.varchar)("return_host", { length: 255 }).notNull(),
    expiresAt: (0, mysql_core_1.timestamp)("expires_at").notNull(),
    usedAt: (0, mysql_core_1.timestamp)("used_at"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow().notNull(),
});
