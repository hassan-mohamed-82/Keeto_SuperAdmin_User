"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socialmedia = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../schema");
exports.socialmedia = (0, mysql_core_1.mysqlTable)("socialmedia", {
    id: (0, mysql_core_1.varchar)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantid: (0, mysql_core_1.varchar)("restaurantid", { length: 36 })
        .references(() => schema_1.restaurants.id)
        .notNull(),
    link: (0, mysql_core_1.varchar)("link", { length: 1024 }),
    icon: (0, mysql_core_1.varchar)("icon", { length: 1024 }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
