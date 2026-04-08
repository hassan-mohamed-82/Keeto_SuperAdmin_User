import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
    text
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
export const cuisines = mysqlTable("cuisines", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    Image: varchar("image", { length: 255 }).notNull(),
    meta_image: varchar("meta_image", { length: 255 }),
    description: text("description"),
    meta_description: text("meta_description"),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    total_restaurants: varchar("total_restaurants", { length: 255 }).default("0"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});