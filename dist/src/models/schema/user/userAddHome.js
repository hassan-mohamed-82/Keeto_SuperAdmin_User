"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userAddHome = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const Users_1 = require("./Users");
const restaurants_1 = require("../admin/restaurants");
exports.userAddHome = (0, mysql_core_1.mysqlTable)("user_add_home", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 }).references(() => Users_1.users.id).notNull(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
