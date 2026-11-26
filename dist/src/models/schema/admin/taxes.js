"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taxes = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
/**
 * source = "keeto"      → created by the super admin (always "exclude").
 *                         restaurantIds = [] → applies to ALL restaurants,
 *                         restaurantIds = [a, b] → applies only to those restaurants.
 *                         restaurantId is NULL.
 * source = "restaurant" → created by the restaurant admin ("include" | "exclude").
 *                         restaurantId = owner restaurant, restaurantIds = [].
 */
exports.taxes = (0, mysql_core_1.mysqlTable)("taxes", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id, { onDelete: "cascade" }),
    restaurantIds: (0, mysql_core_1.json)("restaurant_ids").$type().default([]).notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }),
    amount: (0, mysql_core_1.decimal)("amount", { precision: 10, scale: 2 }).notNull(),
    amountType: (0, mysql_core_1.mysqlEnum)("amount_type", ["percentage", "value"]).default("percentage").notNull(),
    source: (0, mysql_core_1.mysqlEnum)("source", ["keeto", "restaurant"]).default("restaurant").notNull(),
    taxType: (0, mysql_core_1.mysqlEnum)("tax_type", ["include", "exclude"]).default("include").notNull(),
    modules: (0, mysql_core_1.mysqlEnum)("module_type", ["pos", "online", "all"]).default("all").notNull(),
    moduleType: (0, mysql_core_1.mysqlEnum)("type", ["web", "app", "all"]).default("all").notNull(),
    foodIds: (0, mysql_core_1.json)("food_ids").$type().default([]).notNull(),
    branchIds: (0, mysql_core_1.json)("branch_ids").$type().default([]).notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
