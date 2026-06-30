"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardTargets = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
// ==========================================
// Dashboard Targets (SuperAdmin يدخلها ويقارن بيها)
// جدول واحد فقط - Single Row - بيتعمله Upsert
// ==========================================
exports.dashboardTargets = (0, mysql_core_1.mysqlTable)("dashboard_targets", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    totalOrdersTarget: (0, mysql_core_1.int)("total_orders_target").default(0),
    totalCustomersTarget: (0, mysql_core_1.int)("total_customers_target").default(0),
    totalRestaurantsTarget: (0, mysql_core_1.int)("total_restaurants_target").default(0),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
