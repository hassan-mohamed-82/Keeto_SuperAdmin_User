import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const countries = mysqlTable("countries", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});