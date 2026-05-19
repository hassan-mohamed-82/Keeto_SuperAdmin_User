"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.couponRestaurants = exports.couponUsages = exports.coupons = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
const Users_1 = require("../user/Users");
const order_1 = require("./order");
exports.coupons = (0, mysql_core_1.mysqlTable)("coupons", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    // The promo code users type in (unique per restaurant)
    code: (0, mysql_core_1.varchar)("code", { length: 50 }).notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }),
    // percentage | fixed_amount | free_delivery
    discountType: (0, mysql_core_1.mysqlEnum)("discount_type", ["percentage", "fixed_amount", "free_delivery"])
        .notNull()
        .default("percentage"),
    // The value: e.g. 15 means 15% OR 15 currency units (ignored for free_delivery)
    discountValue: (0, mysql_core_1.decimal)("discount_value", { precision: 10, scale: 2 }).notNull(),
    // Optional cap for percentage type
    maxDiscount: (0, mysql_core_1.decimal)("max_discount", { precision: 10, scale: 2 }),
    // Minimum order subtotal to allow using the coupon
    minOrderAmount: (0, mysql_core_1.decimal)("min_order_amount", { precision: 10, scale: 2 }).default("0.00"),
    // Total number of times this coupon can be redeemed across all users
    usageLimit: (0, mysql_core_1.int)("usage_limit"),
    // How many times it has been used so far
    usedCount: (0, mysql_core_1.int)("used_count").default(0),
    // How many times a single user can use it (null = unlimited)
    perUserLimit: (0, mysql_core_1.int)("per_user_limit").default(1),
    startDate: (0, mysql_core_1.timestamp)("start_date"),
    endDate: (0, mysql_core_1.timestamp)("end_date"),
    isActive: (0, mysql_core_1.boolean)("is_active").default(true),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// Tracks which user used which coupon (for per-user limit enforcement)
exports.couponUsages = (0, mysql_core_1.mysqlTable)("coupon_usages", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    couponId: (0, mysql_core_1.char)("coupon_id", { length: 36 })
        .references(() => exports.coupons.id, { onDelete: "cascade" })
        .notNull(),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id)
        .notNull(),
    orderId: (0, mysql_core_1.char)("order_id", { length: 36 })
        .references(() => order_1.orders.id)
        .notNull(),
    discountAmount: (0, mysql_core_1.decimal)("discount_amount", { precision: 10, scale: 2 }).notNull(),
    usedAt: (0, mysql_core_1.timestamp)("used_at").defaultNow(),
});
exports.couponRestaurants = (0, mysql_core_1.mysqlTable)("coupon_restaurants", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    couponId: (0, mysql_core_1.char)("coupon_id", { length: 36 })
        .references(() => exports.coupons.id, { onDelete: "cascade" })
        .notNull(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
