import { mysqlTable, varchar, char, timestamp, decimal, boolean, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants} from "./restaurants"; // تأكد من استيراد جدول المطاعم بشكل صحيح

export const restaurantBusinessPlans = mysqlTable("restaurant_business_plans", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),

    // نوع المنصة
    platformType: mysqlEnum("platform_type", ["online_order", "Keeto_App"]).notNull(),

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

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});