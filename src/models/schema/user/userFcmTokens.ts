import { mysqlTable, char, timestamp, mysqlEnum, uniqueIndex, text } from "drizzle-orm/mysql-core";
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
    deviceType: mysqlEnum("device_type", ["web", "android", "ios"]).default("android"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow()
}, (table) => ({
    userRestaurantTokenIdx: uniqueIndex("unique_user_restaurant_token").on(table.userId, table.restaurantId),
}));
