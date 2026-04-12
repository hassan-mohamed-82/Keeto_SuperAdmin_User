
import { mysqlTable, char, timestamp, decimal, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { zones } from "./zone"; // مسار ملف الـ zones بتاعك
import { restaurants } from "./restaurants";
export const restaurantZoneDeliveryFees = mysqlTable("restaurant_zone_delivery_fees", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),
    zoneId: char("zone_id", { length: 36 }).references(() => zones.id).notNull(),
    
    deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }).notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    
    createdAt: timestamp("created_at").defaultNow(),
});