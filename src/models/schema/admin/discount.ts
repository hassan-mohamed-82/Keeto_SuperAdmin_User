import {
    mysqlTable,
    varchar,
    char,
    timestamp,
    decimal,
    mysqlEnum,
    int,
    boolean,
    uniqueIndex
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";

// ==========================================
// 1. Discounts Table (الجدول الرئيسي)
// ==========================================
export const discounts = mysqlTable("discounts", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
        
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }),
    nameFr: varchar("name_fr", { length: 255 }),

    // percentage | fixed_amount
    discountType: mysqlEnum("discount_type", ["percentage", "fixed_amount"])
        .notNull()
        .default("percentage"),

    discountValue: decimal("discount_value", { precision: 10, scale: 2 }).notNull(),

    maxDiscount: decimal("max_discount", { precision: 10, scale: 2 }),

    minOrderAmount: decimal("min_order_amount", { precision: 10, scale: 2 }).default("0.00"),

    usageLimit: int("usage_limit"),

    usedCount: int("used_count").default(0),

    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),

    isActive: boolean("is_active").default(true),
    
    // الفلاج الجديد لتحديد إذا كان الخصم عاماً لكل المطاعم في حال عدم اختيار مطعم محدد
    isGlobal: boolean("is_global").default(false),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// ==========================================
// 2. Discount Restaurants Table (جدول الربط المشترك)
// ==========================================
export const discountRestaurants = mysqlTable("discount_restaurants", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    discountId: char("discount_id", { length: 36 })
        .references(() => discounts.id, { onDelete: "cascade" })
        .notNull(),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),

    createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
    // قيد يمنع تكرار ربط نفس الخصم بنفس المطعم
    discountRestaurantUnique: uniqueIndex("discount_restaurant_unique_idx").on(table.discountId, table.restaurantId),
}));