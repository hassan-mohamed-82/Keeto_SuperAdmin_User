import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
    decimal,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { cities } from "./city";

export const zones = mysqlTable("zones", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }).notNull().default(''),
    nameFr: varchar("name_fr", { length: 255 }).notNull().default(''),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    displayNameAr: varchar("displayName_ar", { length: 255 }).notNull().default(''),
    displayNameFr: varchar("displayName_fr", { length: 255 }).notNull().default(''),

    // بيانات الجغرافيا والتغطية
    // مصفوفة النقاط التي سيتم رسمها على الخريطة: [{ lat: 31.2, lng: 29.9 }, ...]
    coordinates: json("coordinates").$type<{ lat: number; lng: number }[]>(),

    // مساحة / نصف قطر التغطية بالكيلومتر
    coverageAreaRadiusKm: decimal("coverage_area_radius_km", { precision: 8, scale: 2 }),

    deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }).notNull().default("0.00"),
    minOrderAmount: decimal("min_order_amount", { precision: 10, scale: 2 }).default("0.00"),

    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    cityId: char("cityId", { length: 36 }).references(() => cities.id),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});