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
import { restaurants } from "./restaurants";

export const role_restaurant = mysqlTable("role_restaurant", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId:char("restaurant_id",{length:36}).notNull().references(() => restaurants.id),

    name: varchar("name", { length: 100 }).notNull(),
    permissions: json("permissions").$type<Permission[]>().default([]),

    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});