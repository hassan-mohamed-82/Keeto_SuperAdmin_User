import { mysqlTable, char, int, timestamp } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "./Users";
import { restaurants } from "../admin/restaurants";

export const userRestaurantPoints = mysqlTable("user_restaurant_points", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: char("user_id", { length: 36 })
        .references(() => users.id, { onDelete: "cascade" })
        .notNull(),
    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),
    points: int("points").default(0).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
    createdAt: timestamp("created_at").defaultNow(),
});
