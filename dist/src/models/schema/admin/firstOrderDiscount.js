"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstOrderDiscountUsages = exports.firstOrderDiscounts = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
const Users_1 = require("../user/Users");
const order_1 = require("./order");
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
exports.firstOrderDiscounts = (0, mysql_core_1.mysqlTable)("first_order_discounts", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    /** Human-readable name for this promotion */
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }),
    /** The restaurant that owns this discount */
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull(),
    /**
     * Number of "first orders" that qualify.
     * e.g. 5 → applies to a user's 1st, 2nd, 3rd, 4th, and 5th order.
     */
    firstOrderCount: (0, mysql_core_1.int)("first_order_count").notNull().default(1),
    /** How the discount value is interpreted */
    discountType: (0, mysql_core_1.mysqlEnum)("discount_type", ["percentage", "fixed"]).notNull().default("percentage"),
    /** Discount amount: percentage (e.g. 15 = 15%) or fixed currency amount */
    discountValue: (0, mysql_core_1.decimal)("discount_value", { precision: 10, scale: 2 }).notNull(),
    /** Optional cap on the discount amount (for percentage type) */
    maxDiscountAmount: (0, mysql_core_1.decimal)("max_discount_amount", { precision: 10, scale: 2 }),
    /** Total number of times this discount may be redeemed across ALL users */
    maxUsage: (0, mysql_core_1.int)("max_usage"),
    /** How many times it has been redeemed so far */
    usedCount: (0, mysql_core_1.int)("used_count").notNull().default(0),
    /** Max times a SINGLE user may redeem this discount */
    maxUsagePerUser: (0, mysql_core_1.int)("max_usage_per_user").notNull().default(1),
    startDate: (0, mysql_core_1.timestamp)("start_date"),
    endDate: (0, mysql_core_1.timestamp)("end_date"),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).notNull().default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// ==========================================
// 2. Usage Tracking Table
// ==========================================
/**
 * Records each time a user redeems a first-order discount so we can
 * enforce maxUsagePerUser and maxUsage limits.
 */
exports.firstOrderDiscountUsages = (0, mysql_core_1.mysqlTable)("first_order_discount_usages", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    firstOrderDiscountId: (0, mysql_core_1.char)("first_order_discount_id", { length: 36 })
        .references(() => exports.firstOrderDiscounts.id, { onDelete: "cascade" })
        .notNull(),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id)
        .notNull(),
    orderId: (0, mysql_core_1.char)("order_id", { length: 36 })
        .references(() => order_1.orders.id)
        .notNull(),
    discountAmount: (0, mysql_core_1.decimal)("discount_amount", { precision: 10, scale: 2 }).notNull(),
    usedAt: (0, mysql_core_1.timestamp)("used_at").defaultNow(),
}, (table) => ({
    uniqueUserOrder: (0, mysql_core_1.uniqueIndex)("fod_usage_user_order_unique").on(table.firstOrderDiscountId, table.orderId),
}));
