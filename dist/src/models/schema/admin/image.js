"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.images = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const restaurants_1 = require("./restaurants");
const drizzle_orm_1 = require("drizzle-orm");
exports.images = (0, mysql_core_1.mysqlTable)("images", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantid: (0, mysql_core_1.char)("restaurantid", { length: 36 })
        .references(() => restaurants_1.restaurants.id)
        .notNull(),
    img: (0, mysql_core_1.varchar)("img", { length: 500 }).notNull(),
    periorty: (0, mysql_core_1.int)("periorty").default(0),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
