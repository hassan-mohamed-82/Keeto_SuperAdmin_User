"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.discountRestaurants = exports.discountGroups = exports.discounts = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
// ==========================================
// 1. Discounts Table (الخصم الأساسي / الحملة)
// ==========================================
exports.discounts = (0, mysql_core_1.mysqlTable)("discounts", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }),
    minOrderAmount: (0, mysql_core_1.decimal)("min_order_amount", { precision: 10, scale: 2 }).default("0.00"),
    usageLimit: (0, mysql_core_1.int)("usage_limit"),
    usedCount: (0, mysql_core_1.int)("used_count").default(0),
    startDate: (0, mysql_core_1.timestamp)("start_date"),
    endDate: (0, mysql_core_1.timestamp)("end_date"),
    isActive: (0, mysql_core_1.boolean)("is_active").default(true),
    isGlobal: (0, mysql_core_1.boolean)("is_global").default(false),
    logo: (0, mysql_core_1.varchar)("logo", { length: 500 }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// ==========================================
// 2. Discount Groups Table (الخصم الفرعي — نوع/قيمة/منتجات)
// ==========================================
exports.discountGroups = (0, mysql_core_1.mysqlTable)("discount_groups", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    discountId: (0, mysql_core_1.char)("discount_id", { length: 36 })
        .notNull()
        .references(() => exports.discounts.id, { onDelete: "cascade" }),
    // percentage | fixed_amount
    discountType: (0, mysql_core_1.mysqlEnum)("discount_type", ["percentage", "fixed_amount"])
        .notNull()
        .default("percentage"),
    discountValue: (0, mysql_core_1.decimal)("discount_value", { precision: 10, scale: 2 }).notNull(),
    maxDiscount: (0, mysql_core_1.decimal)("max_discount", { precision: 10, scale: 2 }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
}, (table) => ({
    discountIdx: (0, mysql_core_1.index)("discount_groups_discount_idx").on(table.discountId),
}));
// ==========================================
// 3. Discount Restaurants Table (many-to-many)
// ==========================================
exports.discountRestaurants = (0, mysql_core_1.mysqlTable)("discount_restaurants", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    discountId: (0, mysql_core_1.char)("discount_id", { length: 36 })
        .notNull()
        .references(() => exports.discounts.id, { onDelete: "cascade" }),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .notNull()
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
}, (table) => ({
    discountRestaurantUnique: (0, mysql_core_1.uniqueIndex)("discount_restaurant_unique_idx").on(table.discountId, table.restaurantId),
}));
// export const discountFoods = mysqlTable("discount_foods", {
//     id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
//     discountId: char("discount_id", { length: 36 })
//         .references(() => discounts.id, { onDelete: "cascade" })
//         .notNull(),
//     foodId: char("food_id", { length: 36 })
//         .references(() => food.id, { onDelete: "cascade" })
//         .notNull(),
//     restaurantId: char("restaurant_id", { length: 36 })
//         .notNull()
//         .references(() => restaurants.id, { onDelete: "cascade" }),
//     createdAt: timestamp("created_at").defaultNow(),
// }, (table) => ({
//     discountFoodUnique: uniqueIndex("discount_food_unique_idx").on(table.discountId, table.foodId),
// }));
