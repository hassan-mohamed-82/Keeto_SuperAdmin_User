"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socialmedia = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const restaurants_1 = require("./restaurants");
const platforms_1 = require("./platforms");
const drizzle_orm_1 = require("drizzle-orm");
exports.socialmedia = (0, mysql_core_1.mysqlTable)("socialmedia", {
    id: (0, mysql_core_1.varchar)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantid: (0, mysql_core_1.varchar)("restaurantid", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull(),
    platformId: (0, mysql_core_1.varchar)("platform_id", { length: 36 })
        .references(() => platforms_1.platforms.id, { onDelete: "cascade" })
        .notNull(),
    link: (0, mysql_core_1.varchar)("link", { length: 1024 }).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
