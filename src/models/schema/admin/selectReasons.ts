// models/selectReason.ts
import { mysqlTable, varchar, char, timestamp, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const selectReasons = mysqlTable("select_reasons", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    type: mysqlEnum("type", ["user", "restaurant"]).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
    createdAt: timestamp("created_at").defaultNow(),
});