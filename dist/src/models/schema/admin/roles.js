"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.role_restaurant = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
exports.role_restaurant = (0, mysql_core_1.mysqlTable)("role_restaurant", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).notNull().references(() => restaurants_1.restaurants.id),
    name: (0, mysql_core_1.varchar)("name", { length: 100 }).notNull(),
    permissions: (0, mysql_core_1.json)("permissions").$type().default([]),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
