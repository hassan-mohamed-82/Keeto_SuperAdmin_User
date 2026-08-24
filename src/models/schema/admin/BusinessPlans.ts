import { mysqlTable, varchar, char, timestamp, decimal, boolean, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants"; 

export const restaurantBusinessPlans = mysqlTable("restaurant_business_plans", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),

    // 💡 التعديل هنا: زودنا "pos"
    platformType: mysqlEnum("platform_type", ["online_order_app", "online_order_web", "food_aggregator", "mykeeto", "pos"]).notNull(),

    // الاشتراكات
    isMonthlyActive: boolean("is_monthly_active").default(false),
    monthlyAmount: decimal("monthly_amount", { precision: 10, scale: 2 }).default("0.00"),

    isQuarterlyActive: boolean("is_quarterly_active").default(false),
    quarterlyAmount: decimal("quarterly_amount", { precision: 10, scale: 2 }).default("0.00"),

    isAnnuallyActive: boolean("is_annually_active").default(false),
    annuallyAmount: decimal("annually_amount", { precision: 10, scale: 2 }).default("0.00"),

    // العمولات والرسوم
    commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).default("0.00"), 
    serviceFee: decimal("service_fee", { precision: 10, scale: 2 }).default("0.00"), 

    // حالة المنصة (خاص بـ food_aggregator و mykeeto فقط)
    aggregatorStatus: mysqlEnum("aggregator_status", ["active", "inactive"]).default("active"),
    mykeetoStatus: mysqlEnum("mykeeto_status", ["active", "inactive"]).default("active"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});