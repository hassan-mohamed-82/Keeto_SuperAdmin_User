import { mysqlTable, varchar, char, timestamp, decimal, boolean, mysqlEnum, date as mysqlDate } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { PLATFORM_TYPES } from "../../../types/orderSources";

export const restaurantBusinessPlans = mysqlTable("restaurant_business_plans", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),

    // 💡 التعديل هنا: زودنا "pos"
    // online_order_web | online_order_app | food_aggregator | food_aggregator_web | mykeeto | mykeeto_web | pos
    platformType: mysqlEnum("platform_type", PLATFORM_TYPES).notNull(),

    // الاشتراكات
    isMonthlyActive: boolean("is_monthly_active").default(false),
    monthlyAmount: decimal("monthly_amount", { precision: 10, scale: 2 }).default("0.00"),

    isQuarterlyActive: boolean("is_quarterly_active").default(false),
    quarterlyAmount: decimal("quarterly_amount", { precision: 10, scale: 2 }).default("0.00"),

    isAnnuallyActive: boolean("is_annually_active").default(false),
    annuallyAmount: decimal("annually_amount", { precision: 10, scale: 2 }).default("0.00"),

    // تاريخ بدء الاشتراك / التسجيل (افتراضياً اليوم أو يحدده الأدمن)
    subscriptionStartDate: mysqlDate("subscription_start_date"),

    // العمولات والرسوم
    commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).default("0.00"), 
    serviceFee: decimal("service_fee", { precision: 10, scale: 2 }).default("0.00"), 

    // حالة المنصة (خاص بـ food_aggregator و mykeeto فقط)
    aggregatorStatus: mysqlEnum("aggregator_status", ["active", "inactive"]).default("active"),
    mykeetoStatus: mysqlEnum("mykeeto_status", ["active", "inactive"]).default("active"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});