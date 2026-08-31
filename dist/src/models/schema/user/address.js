"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addresses = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const Users_1 = require("./Users");
const zone_1 = require("../admin/zone");
exports.addresses = (0, mysql_core_1.mysqlTable)("addresses", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 }).references(() => Users_1.users.id).notNull(),
    zoneId: (0, mysql_core_1.char)("zone_id", { length: 36 }).references(() => zone_1.zones.id),
    type: (0, mysql_core_1.mysqlEnum)("type", ["home", "work", "other"]).default("home"),
    title: (0, mysql_core_1.varchar)("title", { length: 255 }).notNull(),
    lat: (0, mysql_core_1.varchar)("lat", { length: 255 }).notNull(),
    lng: (0, mysql_core_1.varchar)("lng", { length: 255 }).notNull(),
    street: (0, mysql_core_1.varchar)("street", { length: 255 }).notNull(),
    number: (0, mysql_core_1.varchar)("number", { length: 20 }).notNull(),
    floor: (0, mysql_core_1.varchar)("floor", { length: 20 }),
    apartment: (0, mysql_core_1.varchar)("apartment", { length: 50 }),
    landmark: (0, mysql_core_1.varchar)("landmark", { length: 500 }),
    location: (0, mysql_core_1.varchar)("location", { length: 255 }),
    fulladdress: (0, mysql_core_1.varchar)("fulladdress", { length: 500 }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow(),
});
