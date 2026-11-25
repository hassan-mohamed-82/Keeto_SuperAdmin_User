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

export type TaxType = "web" | "app" | "all";
export type TaxModuleType = "pos" | "online" | "all";
export type TaxAmountType = "percentage" | "value";
/**
 * include → the food price already contains the tax (display only, NOT added to the total).
 * exclude → the tax is calculated and added on top of the order total.
 * Default is "include". Keeto (super admin) taxes are always "exclude".
 */
export type TaxCalculationType = "include" | "exclude";
/** Who created the tax: "keeto" = super admin, "restaurant" = restaurant admin. */
export type TaxSource = "keeto" | "restaurant";

/**
 * source = "keeto"      → created by the super admin (always "exclude").
 *                         restaurantIds = [] → applies to ALL restaurants,
 *                         restaurantIds = [a, b] → applies only to those restaurants.
 *                         restaurantId is NULL.
 * source = "restaurant" → created by the restaurant admin ("include" | "exclude").
 *                         restaurantId = owner restaurant, restaurantIds = [].
 */
export const taxes = mysqlTable("taxes", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id, { onDelete: "cascade" }),
    restaurantIds: json("restaurant_ids").$type<string[]>().default([]).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }),
    nameFr: varchar("name_fr", { length: 255 }),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    amountType: mysqlEnum("amount_type", ["percentage", "value"]).default("percentage").notNull(),
    source: mysqlEnum("source", ["keeto", "restaurant"]).default("restaurant").notNull(),
    taxType: mysqlEnum("tax_type", ["include", "exclude"]).default("include").notNull(),
    modules: mysqlEnum("module_type", ["pos", "online", "all"]).default("all").notNull(),
    moduleType: mysqlEnum("type", ["web", "app", "all"]).default("all").notNull(),
    foodIds: json("food_ids").$type<string[]>().default([]).notNull(),
    branchIds: json("branch_ids").$type<string[]>().default([]).notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export type Tax = typeof taxes.$inferSelect;
export type NewTax = typeof taxes.$inferInsert;
