import { mysqlTable, char, timestamp, decimal } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { zones } from "./zone"; // مسار ملف الـ zones بتاعك

export const zoneDeliveryFees = mysqlTable("zone_delivery_fees", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    
    fromZoneId: char("from_zone_id", { length: 36 }).references(() => zones.id).notNull(), // منطقة المطعم
    toZoneId: char("to_zone_id", { length: 36 }).references(() => zones.id).notNull(),   // منطقة العميل
    
    fee: decimal("fee", { precision: 10, scale: 2 }).notNull(), // سعر التوصيل
    
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});