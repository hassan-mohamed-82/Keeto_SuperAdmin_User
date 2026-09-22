"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurantGroups = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.restaurantGroups = (0, mysql_core_1.mysqlTable)("restaurant_groups", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }).default(""),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }).default(""),
    restaurants: (0, mysql_core_1.json)("restaurants").$type().default([]).notNull(),
    // نوع التغطية المعتمد للمجموعة (نقاط أو نصف قطر)
    coverageType: (0, mysql_core_1.mysqlEnum)("coverage_type", ["POLYGON", "RADIUS"]).default("POLYGON"),
    // الداتا المخصصة للمجموعة
    customCoordinates: (0, mysql_core_1.json)("custom_coordinates").$type(),
    customRadiusKm: (0, mysql_core_1.decimal)("custom_radius_km", { precision: 8, scale: 2 }),
    // قائمة البانرات (image, link, order)
    banners: (0, mysql_core_1.json)("banners").$type().default([]).notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
