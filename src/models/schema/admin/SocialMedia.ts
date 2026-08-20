import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";
import { restaurants } from "./restaurants";
import { platforms } from "./platforms";
import { sql } from "drizzle-orm";

export const socialmedia = mysqlTable("socialmedia", {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantid: varchar("restaurantid", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),
    platformId: varchar("platform_id", { length: 36 })
        .references(() => platforms.id, { onDelete: "cascade" })
        .notNull(),
    link: varchar("link", { length: 1024 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});