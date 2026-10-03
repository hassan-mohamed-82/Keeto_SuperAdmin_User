"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminFcmTokens = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restrauntadmin_1 = require("./restrauntadmin");
exports.adminFcmTokens = (0, mysql_core_1.mysqlTable)("admin_fcm_tokens", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    adminId: (0, mysql_core_1.char)("admin_id", { length: 36 })
        .references(() => restrauntadmin_1.restrauntadmin.id, { onDelete: "cascade" }).notNull(),
    fcmToken: (0, mysql_core_1.text)("fcm_token").notNull(),
    deviceType: (0, mysql_core_1.mysqlEnum)("device_type", ["web", "android", "ios"]).notNull(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
}, (t) => ({
    uniq: (0, mysql_core_1.uniqueIndex)("unique_admin_device").on(t.adminId, t.deviceType),
}));
