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

export type RestaurantGroupBanner = {
    image: string;
    link?: string | null;
    order?: number | null;
};

export const restaurantGroups = mysqlTable("restaurant_groups", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }).default(""),
    nameFr: varchar("name_fr", { length: 255 }).default(""),
    restaurants: json("restaurants").$type<string[]>().default([]).notNull(),

    // نوع التغطية المعتمد للمجموعة (نقاط أو نصف قطر)
    coverageType: mysqlEnum("coverage_type", ["POLYGON", "RADIUS"]).default("POLYGON"),

    // الداتا المخصصة للمجموعة
    customCoordinates: json("custom_coordinates").$type<{ lat: number; lng: number }[]>(),
    customRadiusKm: decimal("custom_radius_km", { precision: 8, scale: 2 }),

    // قائمة البانرات (image, link, order)
    banners: json("banners").$type<RestaurantGroupBanner[]>().default([]).notNull(),

    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
