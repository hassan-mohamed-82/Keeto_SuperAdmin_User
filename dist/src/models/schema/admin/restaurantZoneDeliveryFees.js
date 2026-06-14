"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurantZoneDeliveryFees = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const zone_1 = require("./zone"); // مسار ملف الـ zones بتاعك
const restaurants_1 = require("./restaurants");
const city_1 = require("./city");
exports.restaurantZoneDeliveryFees = (0, mysql_core_1.mysqlTable)("restaurant_zone_delivery_fees", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id).notNull(),
    zoneId: (0, mysql_core_1.char)("zone_id", { length: 36 }).references(() => zone_1.zones.id).notNull(),
    cityId: (0, mysql_core_1.char)("city_id", { length: 36 }).references(() => city_1.cities.id).notNull(),
    deliveryFee: (0, mysql_core_1.decimal)("delivery_fee", { precision: 10, scale: 2 }).notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
