import {
    mysqlTable,
    varchar,
    char,
    timestamp,
    decimal,
    mysqlEnum,
    int,
    boolean,
    uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { users } from "../user/Users";
import { orders } from "./order";

// ==========================================
// 1. First Order Discounts Table
// ==========================================
/**
 * A "first N orders" discount applied automatically at checkout.
 * Applies to any user whose total completed orders at this restaurant
 * is less than `firstOrderCount`.
 *
 * Example: firstOrderCount = 5 → discount applies to the user's 1st through 5th order.
 */
export const firstOrderDiscounts = mysqlTable("first_order_discounts", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    /** Human-readable name for this promotion */
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }),
    nameFr: varchar("name_fr", { length: 255 }),

    /** The restaurant that owns this discount */
    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),

    /**
     * Number of "first orders" that qualify.
     * e.g. 5 → applies to a user's 1st, 2nd, 3rd, 4th, and 5th order.
     */
    firstOrderCount: int("first_order_count").notNull().default(1),

    /** How the discount value is interpreted */
    discountType: mysqlEnum("discount_type", ["percentage", "fixed"]).notNull().default("percentage"),

    /** Discount amount: percentage (e.g. 15 = 15%) or fixed currency amount */
    discountValue: decimal("discount_value", { precision: 10, scale: 2 }).notNull(),

    /** Optional cap on the discount amount (for percentage type) */
    maxDiscountAmount: decimal("max_discount_amount", { precision: 10, scale: 2 }),

    /** Total number of times this discount may be redeemed across ALL users */
    maxUsage: int("max_usage"),

    /** How many times it has been redeemed so far */
    usedCount: int("used_count").notNull().default(0),

    /** Max times a SINGLE user may redeem this discount */
    maxUsagePerUser: int("max_usage_per_user").notNull().default(1),

    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),

    status: mysqlEnum("status", ["active", "inactive"]).notNull().default("active"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// ==========================================
// 2. Usage Tracking Table
// ==========================================
/**
 * Records each time a user redeems a first-order discount so we can
 * enforce maxUsagePerUser and maxUsage limits.
 */
export const firstOrderDiscountUsages = mysqlTable("first_order_discount_usages", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    firstOrderDiscountId: char("first_order_discount_id", { length: 36 })
        .references(() => firstOrderDiscounts.id, { onDelete: "cascade" })
        .notNull(),

    userId: char("user_id", { length: 36 })
        .references(() => users.id)
        .notNull(),

    orderId: char("order_id", { length: 36 })
        .references(() => orders.id)
        .notNull(),

    discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).notNull(),

    usedAt: timestamp("used_at").defaultNow(),
}, (table) => ({
    uniqueUserOrder: uniqueIndex("fod_usage_user_order_unique").on(table.firstOrderDiscountId, table.orderId),
}));

export type FirstOrderDiscount = typeof firstOrderDiscounts.$inferSelect;
export type NewFirstOrderDiscount = typeof firstOrderDiscounts.$inferInsert;
export type FirstOrderDiscountUsage = typeof firstOrderDiscountUsages.$inferSelect;
