"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurantAppDownloads = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const mysql_core_1 = require("drizzle-orm/mysql-core");
const restaurants_1 = require("./restaurants");
// Store download counts per restaurant app, per platform, per day.
// granularity = "month" rows hold a whole month's total on the month's first day
// (used for iOS history older than 365 days, where Apple only gives monthly reports).
exports.restaurantAppDownloads = (0, mysql_core_1.mysqlTable)("restaurant_app_downloads", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .notNull()
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" }),
    platform: (0, mysql_core_1.mysqlEnum)("platform", ["android", "ios"]).notNull(),
    date: (0, mysql_core_1.date)("date", { mode: "string" }).notNull(),
    granularity: (0, mysql_core_1.mysqlEnum)("granularity", ["day", "month"]).notNull().default("day"),
    downloads: (0, mysql_core_1.int)("downloads").notNull().default(0),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
}, (t) => [
    (0, mysql_core_1.uniqueIndex)("uq_app_downloads_restaurant_platform_date").on(t.restaurantId, t.platform, t.date),
    (0, mysql_core_1.index)("idx_app_downloads_date").on(t.date),
]);
