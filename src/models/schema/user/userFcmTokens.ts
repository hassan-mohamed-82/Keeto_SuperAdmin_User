import { mysqlTable, char, timestamp, mysqlEnum, uniqueIndex, text, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "./Users";
import { restaurants } from "../admin/restaurants";

export const userFcmTokens = mysqlTable("user_fcm_tokens", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: char("user_id", { length: 36 })
        .references(() => users.id, { onDelete: "cascade" })
        .notNull(),
    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" }),
    fcmToken: text("fcm_token").notNull(),
    firebaseProject: varchar("firebase_project", { length: 50 }).notNull().default("primary"),
    deviceType: mysqlEnum("device_type", ["web", "android", "ios"]).default("web"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow()
}, (table) => ({
    userRestaurantTokenIdx: uniqueIndex("unique_user_restaurant_device ").on(table.userId, table.restaurantId, table.deviceType),
}));
