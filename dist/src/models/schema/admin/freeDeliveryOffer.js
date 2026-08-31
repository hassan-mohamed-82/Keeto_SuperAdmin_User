"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.freeDeliveryOffers = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
exports.freeDeliveryOffers = (0, mysql_core_1.mysqlTable)("free_delivery_offers", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull()
        .unique(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"])
        .default("active")
        .notNull(),
    minOrderAmount: (0, mysql_core_1.decimal)("min_order_amount", { precision: 10, scale: 2 })
        .default("0.00")
        .notNull(),
    startDate: (0, mysql_core_1.timestamp)("start_date"),
    endDate: (0, mysql_core_1.timestamp)("end_date"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
