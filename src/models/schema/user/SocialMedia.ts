import { mysqlTable, varchar, timestamp } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "../../schema";

export const socialmedia = mysqlTable("socialmedia", {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantid: varchar("restaurantid", { length: 36 })
        .references(() => restaurants.id)
        .notNull(),
    link: varchar("link", { length: 1024 }),
    icon: varchar("icon", { length: 1024 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});