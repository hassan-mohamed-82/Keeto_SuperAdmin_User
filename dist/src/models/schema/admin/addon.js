"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addons = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const adonescategory_1 = require("./adonescategory");
const restaurants_1 = require("./restaurants");
exports.addons = (0, mysql_core_1.mysqlTable)("addons", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    price: (0, mysql_core_1.varchar)("price", { length: 255 }).notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    stock_type: (0, mysql_core_1.mysqlEnum)("stock_type", ["unlimited", "limited", "daily"]).default("unlimited"),
    adonescategoryid: (0, mysql_core_1.char)("adonescategory_id", { length: 36 }).references(() => adonescategory_1.adonescategory.id).notNull(),
    restaurantid: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
