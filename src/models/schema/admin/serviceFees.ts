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

export type ServiceFeeModule = "take_away" | "dine_in" | "delivery" | "car" | "all";
export type ServiceFeeType = "web" | "app" | "all";
export type AmountType = "percentage" | "value";

export const serviceFees = mysqlTable("service_fees", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    amountType: mysqlEnum("amount_type", ["percentage", "value"]).default("percentage").notNull(),
    modules: json("modules").$type<ServiceFeeModule[]>().default(["all"]).notNull(),
    type: mysqlEnum("type", ["web", "app", "all"]).default("all").notNull(),
    branchIds: json("branch_ids").$type<string[]>().default([]).notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export type ServiceFee = typeof serviceFees.$inferSelect;
export type NewServiceFee = typeof serviceFees.$inferInsert;
