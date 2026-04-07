import { mysqlTable, varchar, char, timestamp, mysqlEnum, json } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { roles } from "./roles";
import { Permission } from "../../../types/custom";

export const admins = mysqlTable("admins", {
    id: char("id", { length: 255 }).primaryKey().notNull().default(sql`(uuid())`),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    type: mysqlEnum("type", ["super_admin", "admin"]).notNull().default("admin"),
    phoneNumber: varchar("phone_number", { length: 255 }).notNull(),
    password: varchar("password", { length: 255 }).notNull(),
    roleId: char("role_id", { length: 36 }).references(() => roles.id),
    permissions: json("permissions").$type<Permission[]>().default([]),
    status: mysqlEnum("status", ["active", "inactive"]).notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
});