"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taxType = exports.taxTypes = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
exports.taxTypes = (0, mysql_core_1.mysqlTable)("tax_types", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restrauntid: (0, mysql_core_1.char)("restrauntid", { length: 36 }).references(() => restaurants_1.restaurants.id).notNull(),
    type: (0, mysql_core_1.mysqlEnum)("type", ["include", "exclude"]).default("exclude").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
exports.taxType = exports.taxTypes;
