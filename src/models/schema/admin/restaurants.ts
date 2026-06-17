// models/schema/restaurants.ts
import { mysqlTable, varchar, timestamp, json, char, text, date, mysqlEnum, boolean, int } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { zones } from "./zone";
import { sales } from "./sales"; // 👈 استدعاء جدول السيلز

export const restaurants = mysqlTable("restaurants", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    fcmToken: text("fcm_token"),

    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }),
    nameFr: varchar("name_fr", { length: 255 }),
    address: text("address"),
    addressAr: text("address_ar").default(''),
    addressFr: text("address_fr").default(''),
    
    cuisineId: json("cuisine_id").$type<string[]>().default([]),
    zoneId: char("zone_id", { length: 36 }).references(() => zones.id),

    // 👇 التعديلات الجديدة هنا
    type: mysqlEnum("type", ["mega", "super", "A", "B", "C", "C-"]).default("C"), // نوع المطعم
    salesId: char("sales_id", { length: 36 }).references(() => sales.id), // المندوب اللي جاب المطعم
    // 👆

    logo: varchar("logo", { length: 500 }).notNull(),
    cover: varchar("cover", { length: 500 }),

    minDeliveryTime: varchar("min_delivery_time", { length: 50 }),
    maxDeliveryTime: varchar("max_delivery_time", { length: 50 }),
    deliveryTimeUnit: varchar("delivery_time_unit", { length: 50 }).default("Minutes"),

    ownerFirstName: varchar("owner_first_name", { length: 255 }).notNull(),
    ownerLastName: varchar("owner_last_name", { length: 255 }).notNull(),
    ownerPhone: varchar("owner_phone", { length: 50 }).notNull(),

    tags: json("tags").$type<string[]>().default([]),
    lat: varchar("lat", { length: 255 }),
    lng: varchar("lng", { length: 255 }),

    taxNumber: varchar("tax_number", { length: 255 }),
    taxExpireDate: date("tax_expire_date"), 
    taxCertificate: varchar("tax_certificate", { length: 255 }), 
    addhome: boolean("addhome").default(false),
    deliveryRadiusKm: int("delivery_radius_km").default(0),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});