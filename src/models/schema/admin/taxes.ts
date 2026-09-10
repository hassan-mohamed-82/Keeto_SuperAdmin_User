import {
    mysqlTable,
    varchar,
    char,
    timestamp,
    decimal,
    mysqlEnum,
    json
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";

export type TaxModule = "take_away" | "dine_in" | "delivery" | "car" | "all";
export type TaxType = "web" | "app" | "all";
export type TaxAmountType = "percentage" | "value";

export const taxes = mysqlTable("taxes", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    amountType: mysqlEnum("amount_type", ["percentage", "value"]).default("percentage").notNull(),
    modules: json("modules").$type<TaxModule[]>().default(["all"]).notNull(),
    type: mysqlEnum("type", ["web", "app", "all"]).default("all").notNull(),
    foodIds: json("food_ids").$type<string[]>().default([]).notNull(),
    branchIds: json("branch_ids").$type<string[]>().default([]).notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export type Tax = typeof taxes.$inferSelect;
export type NewTax = typeof taxes.$inferInsert;
