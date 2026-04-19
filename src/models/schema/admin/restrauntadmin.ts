import { mysqlTable, varchar, char, timestamp, mysqlEnum, json } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { rolesadmin } from "./rolesadmin";
import { Permission } from "../../../types/custom";
import { restaurants } from "./restaurants";
import { branches } from "./branches";

export const restrauntadmin = mysqlTable("restrauntadmins", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(uuid())`),

    // الموظف ده تبع أنهي مطعم؟ وتبع أنهي فرع؟
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),
    branchId: char("branch_id", { length: 36 }).references(() => branches.id),

    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    password: varchar("password", { length: 255 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 255 }).notNull(),

    type: mysqlEnum("type", ["subadmin", "branch_manager"]).notNull().default("branch_manager"),

    roleId: char("role_id", { length: 36 }).references(() => rolesadmin.id),
    permissions: json("permissions").$type<Permission[]>().default([]),
    status: mysqlEnum("status", ["active", "inactive"]).notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow(),
});