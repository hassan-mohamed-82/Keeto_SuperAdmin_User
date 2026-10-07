import { sql } from "drizzle-orm";
import { char, json, mysqlEnum, mysqlTable, timestamp } from "drizzle-orm/mysql-core";
import { restaurants } from "./restaurants";

export const restaurantOperations = mysqlTable("restaurant_operations", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 })
        .notNull()
        .unique()
        .references(() => restaurants.id),
    operationType: mysqlEnum("operation_type", ["callcenter", "branch"])
        .notNull()
        .default("callcenter"),
    status: mysqlEnum("status", [
        "demo",
        "sales",
        "data",
        "customer support",
        "visit",
        "start order",
        "qr",
        "points",
        "social media",
    ]),
    app: mysqlEnum("app", ["on", "off"]),
    notes: json("notes").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
