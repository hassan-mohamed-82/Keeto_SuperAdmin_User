"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cuisines = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.cuisines = (0, mysql_core_1.mysqlTable)("cuisines", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    Image: (0, mysql_core_1.varchar)("image", { length: 255 }).notNull(),
    meta_image: (0, mysql_core_1.varchar)("meta_image", { length: 255 }),
    description: (0, mysql_core_1.text)("description"),
    meta_description: (0, mysql_core_1.text)("meta_description"),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    total_restaurants: (0, mysql_core_1.varchar)("total_restaurants", { length: 255 }).default("0"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
