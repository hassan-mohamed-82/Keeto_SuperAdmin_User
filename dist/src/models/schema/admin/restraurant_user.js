"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurant_users = void 0;
// models/restaurantWallet.ts
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
const Users_1 = require("../user/Users");
exports.restaurant_users = (0, mysql_core_1.mysqlTable)("restaurant_users", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id)
        .notNull(),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id)
        .notNull()
});
