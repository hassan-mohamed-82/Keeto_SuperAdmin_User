"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zones = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const city_1 = require("./city");
exports.zones = (0, mysql_core_1.mysqlTable)("zones", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    displayName: (0, mysql_core_1.varchar)("displayName", { length: 255 }).notNull(),
    lat: (0, mysql_core_1.varchar)("lat", { length: 255 }).notNull(),
    lng: (0, mysql_core_1.varchar)("lng", { length: 255 }).notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    cityId: (0, mysql_core_1.char)("cityId", { length: 36 }).references(() => city_1.cities.id),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
