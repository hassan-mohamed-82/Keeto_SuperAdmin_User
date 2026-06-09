"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurants = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const zone_1 = require("./zone");
exports.restaurants = (0, mysql_core_1.mysqlTable)("restaurants", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    fcmToken: (0, mysql_core_1.text)("fcm_token"),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }),
    address: (0, mysql_core_1.text)("address").notNull(),
    addressAr: (0, mysql_core_1.text)("address_ar").notNull().default(''),
    addressFr: (0, mysql_core_1.text)("address_fr").notNull().default(''),
    cuisineId: (0, mysql_core_1.json)("cuisine_id").$type().default([]),
    zoneId: (0, mysql_core_1.char)("zone_id", { length: 36 }).references(() => zone_1.zones.id).notNull(),
    logo: (0, mysql_core_1.varchar)("logo", { length: 500 }).notNull(),
    cover: (0, mysql_core_1.varchar)("cover", { length: 500 }),
    minDeliveryTime: (0, mysql_core_1.varchar)("min_delivery_time", { length: 50 }),
    maxDeliveryTime: (0, mysql_core_1.varchar)("max_delivery_time", { length: 50 }),
    deliveryTimeUnit: (0, mysql_core_1.varchar)("delivery_time_unit", { length: 50 }).default("Minutes"),
    // بيانات المالك كجهة اتصال للبزنس وليس للدخول
    ownerFirstName: (0, mysql_core_1.varchar)("owner_first_name", { length: 255 }).notNull(),
    ownerLastName: (0, mysql_core_1.varchar)("owner_last_name", { length: 255 }).notNull(),
    ownerPhone: (0, mysql_core_1.varchar)("owner_phone", { length: 50 }).notNull(),
    tags: (0, mysql_core_1.json)("tags").$type().default([]),
    lat: (0, mysql_core_1.varchar)("lat", { length: 255 }),
    lng: (0, mysql_core_1.varchar)("lng", { length: 255 }),
    taxNumber: (0, mysql_core_1.varchar)("tax_number", { length: 255 }),
    taxExpireDate: (0, mysql_core_1.date)("tax_expire_date"),
    taxCertificate: (0, mysql_core_1.varchar)("tax_certificate", { length: 255 }),
    addhome: (0, mysql_core_1.boolean)("addhome").default(false),
    deliveryRadiusKm: (0, mysql_core_1.int)("delivery_radius_km").default(0),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
