import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
    text, decimal, int,
    time,
    boolean
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { cities, food, ingredients, restaurants, zones } from "../../schema";

export const branches = mysqlTable("branches", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),
    name: varchar("name", { length: 255 }).notNull(), // فرع مدينة نصر مثلاً
    nameAr: varchar("name_ar", { length: 255 }),
    nameFr: varchar("name_fr", { length: 255 }),
    address: text("address").notNull(),
    addressAr: text("address_ar"),
    addressFr: text("address_fr"),
    phoneNumber: varchar("phone_number", { length: 50 }),
    zoneId: char("zone_id", { length: 36 }).references(() => zones.id).notNull(),
    cityId: char("city_id", { length: 36 }).references(() => cities.id),
    deliveryRadiusKm: decimal("delivery_radius_km", { precision: 6, scale: 2 }).default("0"),
    lat: varchar("lat", { length: 255 }),
    lng: varchar("lng", { length: 255 }),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
});

export const branchMenuItems = mysqlTable("branch_menu_items", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    branchId: char("branch_id", { length: 36 }).references(() => branches.id).notNull(),
    foodId: char("food_id", { length: 36 }).references(() => food.id).notNull(),

    // السعر اختياري: إذا كان NULL يعتمد basePrice من جدول food
    price: decimal("price", { precision: 10, scale: 2 }),

    stockType: mysqlEnum("stock_type", ["limited", "unlimited"]).default("unlimited"),
    stockQty: int("stock_qty").default(0),

    // حالة الأكلة يدويًا في هذا الفرع (نشط أو موقوف بقرار مدير الفرع)
    status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});


// ===================================================
// جدول قفل وتوفر المكونات per-branch (عام أو لمنتج معين)
// ===================================================
export const branchIngredientLocks = mysqlTable("branch_ingredient_locks", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    branchId: char("branch_id", { length: 36 })
        .references(() => branches.id)
        .notNull(),

    // إذا كانت NULL -> القفل يطبق على المكون في الفرع ككل (لكل الوجبات)
    // إذا كانت بها UUID -> القفل يطبق على هذا المكون لهذه الوجبة فقط داخل هذا الفرع
    foodId: char("food_id", { length: 36 })
        .references(() => food.id),

    ingredientId: char("ingredient_id", { length: 36 })
        .references(() => ingredients.id)
        .notNull(),

    // false = المكون غير متاح
    isAvailable: boolean("is_available").default(true).notNull(),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});