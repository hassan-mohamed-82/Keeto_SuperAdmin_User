"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoices = void 0;
// models/schema.ts (أضف هذا الجدول لملف الـ schema الخاص بك)
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants"); // تأكد من مسار الـ import
exports.invoices = (0, mysql_core_1.mysqlTable)("invoices", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id).notNull(),
    invoiceNumber: (0, mysql_core_1.varchar)("invoice_number", { length: 50 }).notNull().unique(), // مثلا INV-1718292
    startDate: (0, mysql_core_1.timestamp)("start_date").notNull(),
    endDate: (0, mysql_core_1.timestamp)("end_date").notNull(),
    totalOrders: (0, mysql_core_1.int)("total_orders").notNull(),
    totalGrossSales: (0, mysql_core_1.decimal)("total_gross_sales", { precision: 10, scale: 2 }).notNull(),
    totalCashCollected: (0, mysql_core_1.decimal)("total_cash_collected", { precision: 10, scale: 2 }).notNull(),
    totalDigitalCollected: (0, mysql_core_1.decimal)("total_digital_collected", { precision: 10, scale: 2 }).notNull(),
    totalCommission: (0, mysql_core_1.decimal)("total_commission", { precision: 10, scale: 2 }).notNull(),
    totalServiceFee: (0, mysql_core_1.decimal)("total_service_fee", { precision: 10, scale: 2 }).notNull(),
    restaurantOwesPlatform: (0, mysql_core_1.decimal)("restaurant_owes_platform", { precision: 10, scale: 2 }).notNull(),
    platformOwesRestaurant: (0, mysql_core_1.decimal)("platform_owes_restaurant", { precision: 10, scale: 2 }).notNull(),
    netBalance: (0, mysql_core_1.decimal)("net_balance", { precision: 10, scale: 2 }).notNull(), // الموجب المنصة تدفع، السالب المطعم يدفع
    status: (0, mysql_core_1.mysqlEnum)("status", ["unpaid", "paid", "cancelled"]).default("unpaid"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
