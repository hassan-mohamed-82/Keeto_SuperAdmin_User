// models/schema.ts (أضف هذا الجدول لملف الـ schema الخاص بك)
import { mysqlTable, char, varchar, timestamp, mysqlEnum, decimal, int } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants"; // تأكد من مسار الـ import

export const invoices = mysqlTable("invoices", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),
    
    invoiceNumber: varchar("invoice_number", { length: 50 }).notNull().unique(), // مثلا INV-1718292
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    
    totalOrders: int("total_orders").notNull(),
    totalGrossSales: decimal("total_gross_sales", { precision: 10, scale: 2 }).notNull(),
    totalCashCollected: decimal("total_cash_collected", { precision: 10, scale: 2 }).notNull(),
    totalDigitalCollected: decimal("total_digital_collected", { precision: 10, scale: 2 }).notNull(),
    
    totalCommission: decimal("total_commission", { precision: 10, scale: 2 }).notNull(),
    totalServiceFee: decimal("total_service_fee", { precision: 10, scale: 2 }).notNull(),
    
    restaurantOwesPlatform: decimal("restaurant_owes_platform", { precision: 10, scale: 2 }).notNull(),
    platformOwesRestaurant: decimal("platform_owes_restaurant", { precision: 10, scale: 2 }).notNull(),
    netBalance: decimal("net_balance", { precision: 10, scale: 2 }).notNull(), // الموجب المنصة تدفع، السالب المطعم يدفع
    
    status: mysqlEnum("status", ["unpaid", "paid", "cancelled"]).default("unpaid"),
    
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});