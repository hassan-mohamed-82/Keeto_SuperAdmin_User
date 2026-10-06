// models/schema/admin/gatewaySwitchLog.ts
// Audit log for every payment-gateway type change (automatic or manual).
import {
    mysqlTable,
    char,
    mysqlEnum,
    decimal,
    timestamp,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";

export const gatewaySwitchLog = mysqlTable("gateway_switch_log", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id)
        .notNull(),

    // Previous and new gateway type
    fromType: mysqlEnum("from_type", ["SYSTEM", "CUSTOM"]).notNull(),
    toType: mysqlEnum("to_type", ["SYSTEM", "CUSTOM"]).notNull(),

    // What caused the switch
    trigger: mysqlEnum("trigger", [
        "amount",
        "day_of_week",
        "day_of_month",
        "manual",
    ]).notNull(),

    // Wallet balance at the moment of the switch (negative = restaurant is in debt)
    balanceAtSwitch: decimal("balance_at_switch", { precision: 10, scale: 2 }).notNull(),

    // Set when a human admin triggered the change (null for automatic switches)
    adminId: char("admin_id", { length: 36 }),

    createdAt: timestamp("created_at").defaultNow(),
});
