import { mysqlTable, int, timestamp, char } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ==========================================
// Dashboard Targets (SuperAdmin يدخلها ويقارن بيها)
// جدول واحد فقط - Single Row - بيتعمله Upsert
// ==========================================
export const dashboardTargets = mysqlTable("dashboard_targets", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    totalOrdersTarget: int("total_orders_target").default(0),
    totalCustomersTarget: int("total_customers_target").default(0),
    totalRestaurantsTarget: int("total_restaurants_target").default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
