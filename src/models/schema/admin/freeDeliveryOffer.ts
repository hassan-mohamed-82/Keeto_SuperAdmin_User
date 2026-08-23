import {
    mysqlTable,
    char,
    decimal,
    timestamp,
    mysqlEnum
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";

export const freeDeliveryOffers = mysqlTable("free_delivery_offers", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull()
        .unique(),

    status: mysqlEnum("status", ["active", "inactive"])
        .default("active")
        .notNull(),

    minOrderAmount: decimal("min_order_amount", { precision: 10, scale: 2 })
        .default("0.00")
        .notNull(),

    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
