// models/selectReason.ts
import { mysqlTable, varchar, char, timestamp, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const selectReasons = mysqlTable("select_reasons", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    type: mysqlEnum("type", ["user", "restaurant"]).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }).notNull().default(''),
    nameFr: varchar("name_fr", { length: 255 }).notNull().default(''),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
    createdAt: timestamp("created_at").defaultNow(),
});