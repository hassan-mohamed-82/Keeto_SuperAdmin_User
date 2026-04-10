"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurantBusinessPlans = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants"); // تأكد من استيراد جدول المطاعم بشكل صحيح
exports.restaurantBusinessPlans = (0, mysql_core_1.mysqlTable)("restaurant_business_plans", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id).notNull(),
    // نوع المنصة
    platformType: (0, mysql_core_1.mysqlEnum)("platform_type", ["online_order", "food_aggregator"]).notNull(),
    // الاشتراكات
    isMonthlyActive: (0, mysql_core_1.boolean)("is_monthly_active").default(false),
    monthlyAmount: (0, mysql_core_1.decimal)("monthly_amount", { precision: 10, scale: 2 }).default("0.00"),
    isQuarterlyActive: (0, mysql_core_1.boolean)("is_quarterly_active").default(false),
    quarterlyAmount: (0, mysql_core_1.decimal)("quarterly_amount", { precision: 10, scale: 2 }).default("0.00"),
    isAnnuallyActive: (0, mysql_core_1.boolean)("is_annually_active").default(false),
    annuallyAmount: (0, mysql_core_1.decimal)("annually_amount", { precision: 10, scale: 2 }).default("0.00"),
    // العمولات والرسوم
    commissionRate: (0, mysql_core_1.decimal)("commission_rate", { precision: 5, scale: 2 }).default("0.00"),
    serviceFee: (0, mysql_core_1.decimal)("service_fee", { precision: 10, scale: 2 }).default("0.00"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
