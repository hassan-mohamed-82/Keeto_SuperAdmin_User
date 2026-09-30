import { mysqlTable, char, timestamp, mysqlEnum, uniqueIndex, text } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restrauntadmin } from "./restrauntadmin";

export const adminFcmTokens = mysqlTable("admin_fcm_tokens", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    adminId: char("admin_id", { length: 36 })
        .references(() => restrauntadmin.id, { onDelete: "cascade" }).notNull(),
    fcmToken: text("fcm_token").notNull(),
    deviceType: mysqlEnum("device_type", ["web", "android", "ios"]).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (t) => ({
    uniq: uniqueIndex("unique_admin_device").on(t.adminId, t.deviceType),
}));