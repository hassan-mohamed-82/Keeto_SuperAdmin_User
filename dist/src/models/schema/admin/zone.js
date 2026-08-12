"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zones = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const city_1 = require("./city");
exports.zones = (0, mysql_core_1.mysqlTable)("zones", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }).notNull().default(''),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }).notNull().default(''),
    displayName: (0, mysql_core_1.varchar)("displayName", { length: 255 }).notNull(),
    displayNameAr: (0, mysql_core_1.varchar)("displayName_ar", { length: 255 }).notNull().default(''),
    displayNameFr: (0, mysql_core_1.varchar)("displayName_fr", { length: 255 }).notNull().default(''),
    // بيانات الجغرافيا والتغطية
    // مصفوفة النقاط التي سيتم رسمها على الخريطة: [{ lat: 31.2, lng: 29.9 }, ...]
    coordinates: (0, mysql_core_1.json)("coordinates").$type(),
    // مساحة / نصف قطر التغطية بالكيلومتر
    coverageAreaRadiusKm: (0, mysql_core_1.decimal)("coverage_area_radius_km", { precision: 8, scale: 2 }),
    deliveryFee: (0, mysql_core_1.decimal)("delivery_fee", { precision: 10, scale: 2 }).notNull().default("0.00"),
    minOrderAmount: (0, mysql_core_1.decimal)("min_order_amount", { precision: 10, scale: 2 }).default("0.00"),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    cityId: (0, mysql_core_1.char)("cityId", { length: 36 }).references(() => city_1.cities.id),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
