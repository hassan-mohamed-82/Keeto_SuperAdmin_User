"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gatewaySwitchLog = void 0;
// models/schema/admin/gatewaySwitchLog.ts
// Audit log for every payment-gateway type change (automatic or manual).
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
exports.gatewaySwitchLog = (0, mysql_core_1.mysqlTable)("gateway_switch_log", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id)
        .notNull(),
    // Previous and new gateway type
    fromType: (0, mysql_core_1.mysqlEnum)("from_type", ["SYSTEM", "CUSTOM"]).notNull(),
    toType: (0, mysql_core_1.mysqlEnum)("to_type", ["SYSTEM", "CUSTOM"]).notNull(),
    // What caused the switch
    trigger: (0, mysql_core_1.mysqlEnum)("trigger", [
        "amount",
        "day_of_week",
        "day_of_month",
        "manual",
    ]).notNull(),
    // Wallet balance at the moment of the switch (negative = restaurant is in debt)
    balanceAtSwitch: (0, mysql_core_1.decimal)("balance_at_switch", { precision: 10, scale: 2 }).notNull(),
    // Set when a human admin triggered the change (null for automatic switches)
    adminId: (0, mysql_core_1.char)("admin_id", { length: 36 }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
