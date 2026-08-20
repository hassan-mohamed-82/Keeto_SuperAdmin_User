import { mysqlTable, char, timestamp, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { users } from "../user/Users";

export const restaurant_users = mysqlTable("restaurant_users", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id)
        .notNull(),
    userId: char("user_id", { length: 36 })
        .references(() => users.id)
        .notNull(),
    status: mysqlEnum("status", ["active", "blocked"]).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow()
});
