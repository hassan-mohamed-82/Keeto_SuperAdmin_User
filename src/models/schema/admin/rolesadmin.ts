import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
} from "drizzle-orm/mysql-core";
import { Permission } from "../../../types/custom";
import { sql } from "drizzle-orm";

export const rolesadmin = mysqlTable("rolesadmin", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    name: varchar("name", { length: 100 }).notNull(),
    permissions: json("permissions").$type<Permission[]>().default([]),

    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});