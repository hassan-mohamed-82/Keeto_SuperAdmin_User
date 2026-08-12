import { mysqlTable, char, timestamp, decimal, mysqlEnum, json } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { zones } from "./zone";
import { restaurants } from "./restaurants";
import { cities } from "./city";

export const restaurantZoneDeliveryFees = mysqlTable("restaurant_zone_delivery_fees", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),
    zoneId: char("zone_id", { length: 36 }).references(() => zones.id).notNull(),
    cityId: char("city_id", { length: 36 }).references(() => cities.id).notNull(),

    // نوع التغطية المعتمد للمطعم في هذه الزون (نقاط أو نصف قطر)
    coverageType: mysqlEnum("coverage_type", ["POLYGON", "RADIUS"]).default("POLYGON"),

    // الداتا المخصصة للمطعم (إذا عدل على الداتا الافتراضية المجلوبة من السوبر أدمن)
    customCoordinates: json("custom_coordinates").$type<{ lat: number; lng: number }[]>(),
    customRadiusKm: decimal("custom_radius_km", { precision: 8, scale: 2 }),

    // رسوم التوصيل والحد الأدنى للطلب الخاصين بالمطعم
    deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }).notNull().default("0.00"),
    minOrderAmount: decimal("min_order_amount", { precision: 10, scale: 2 }).default("0.00"),

    status: mysqlEnum("status", ["active", "inactive"]).default("active"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});