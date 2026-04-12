import { mysqlTable, char, timestamp, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "./Users";
import { restaurants } from "../admin/restaurants";
import { food } from "../admin/food"; // مسار جدول الأكل

export const favorites = mysqlTable("favorites", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: char("user_id", { length: 36 }).references(() => users.id).notNull(),

    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id),
    foodId: char("food_id", { length: 36 }).references(() => food.id),

    createdAt: timestamp("created_at").defaultNow(),
});