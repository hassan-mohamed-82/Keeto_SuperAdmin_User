import {
    mysqlTable,
    varchar,
    char,
    timestamp,
    decimal,
    mysqlEnum,
    int,
    boolean,
    json,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";

export const coupons = mysqlTable("coupons", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: json("restaurant_id").$type<string[]>().default([]),

    // The promo code users type in (unique per restaurant)
    code: varchar("code", { length: 50 }).notNull().unique(),

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

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// Tracks which user used which coupon (for per-user limit enforcement)
export const couponUsages = mysqlTable("coupon_usages", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    couponId: char("coupon_id", { length: 36 })
        .references(() => coupons.id)
        .notNull(),

    userId: char("user_id", { length: 36 }).notNull(),

    orderId: char("order_id", { length: 36 }).notNull(),

    discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).notNull(),

    usedAt: timestamp("used_at").defaultNow(),
});
