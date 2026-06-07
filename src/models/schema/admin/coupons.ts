import {
    mysqlTable,
    varchar,
    char,
    timestamp,
    decimal,
    mysqlEnum,
    int,
    boolean,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { users } from "../user/Users";
import { orders } from "./order";

export const coupons = mysqlTable("coupons", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    // The promo code users type in (unique per restaurant or global)
    code: varchar("code", { length: 50 }).notNull(),

    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }),
    nameFr: varchar("name_fr", { length: 255 }),

    // percentage | fixed_amount | free_delivery
    discountType: mysqlEnum("discount_type", ["percentage", "fixed_amount", "free_delivery"])
        .notNull()
        .default("percentage"),

    // The value: e.g. 15 means 15% OR 15 currency units (ignored for free_delivery)
    discountValue: decimal("discount_value", { precision: 10, scale: 2 }).notNull(),

    // Optional cap for percentage type
    maxDiscount: decimal("max_discount", { precision: 10, scale: 2 }),

    // Minimum order subtotal to allow using the coupon
    minOrderAmount: decimal("min_order_amount", { precision: 10, scale: 2 }).default("0.00"),

    // Total number of times this coupon can be redeemed across all users
    usageLimit: int("usage_limit"),

    // How many times it has been used so far
    usedCount: int("used_count").default(0),

    // How many times a single user can use it (null = unlimited)
    perUserLimit: int("per_user_limit").default(1),

    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),

    isActive: boolean("is_active").default(true),
    
    isGlobal: boolean("is_global").default(false).notNull(),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// Tracks which user used which coupon (for per-user limit enforcement)
export const couponUsages = mysqlTable("coupon_usages", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    couponId: char("coupon_id", { length: 36 })
        .references(() => coupons.id, { onDelete: "cascade" })
        .notNull(),

    userId: char("user_id", { length: 36 })
        .references(() => users.id)
        .notNull(),

    orderId: char("order_id", { length: 36 })
        .references(() => orders.id)
        .notNull(),

    discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).notNull(),

    usedAt: timestamp("used_at").defaultNow(),
});

export const couponRestaurants = mysqlTable("coupon_restaurants", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    couponId: char("coupon_id", { length: 36 })
        .references(() => coupons.id, { onDelete: "cascade" })
        .notNull(),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),

    createdAt: timestamp("created_at").defaultNow(),
});
