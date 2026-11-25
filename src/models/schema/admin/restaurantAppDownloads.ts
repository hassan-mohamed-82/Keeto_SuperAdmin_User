import { sql } from "drizzle-orm";
import { char, date, index, int, mysqlEnum, mysqlTable, timestamp, uniqueIndex } from "drizzle-orm/mysql-core";
import { restaurants } from "./restaurants";

// Store download counts per restaurant app, per platform, per day.
// granularity = "month" rows hold a whole month's total on the month's first day
// (used for iOS history older than 365 days, where Apple only gives monthly reports).
export const restaurantAppDownloads = mysqlTable(
    "restaurant_app_downloads",
    {
        id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
        restaurantId: char("restaurant_id", { length: 36 })
            .notNull()
            .references(() => restaurants.id, { onDelete: "cascade" }),
        platform: mysqlEnum("platform", ["android", "ios"]).notNull(),
        date: date("date", { mode: "string" }).notNull(),
        granularity: mysqlEnum("granularity", ["day", "month"]).notNull().default("day"),
        downloads: int("downloads").notNull().default(0),
        createdAt: timestamp("created_at").defaultNow(),
        updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
    },
    (t) => [
        uniqueIndex("uq_app_downloads_restaurant_platform_date").on(t.restaurantId, t.platform, t.date),
        index("idx_app_downloads_date").on(t.date),
    ]
);
