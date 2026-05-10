import { mysqlTable, char, timestamp } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "./Users";
import { restaurants } from "../admin/restaurants";

export const userAddHome = mysqlTable("user_add_home", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: char("user_id", { length: 36 }).references(() => users.id).notNull(),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
});
