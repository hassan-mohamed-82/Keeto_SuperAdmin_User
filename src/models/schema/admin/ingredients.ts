import { mysqlTable, varchar, timestamp, mysqlEnum, char, boolean } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "../admin/restaurants";
import { food } from "../admin/food";

// 1. جدول تصنيفات المكونات (مثال: فواكه، ألبان، لحوم، بهارات)
export const ingredientCategories = mysqlTable("ingredient_categories", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("nameAr", { length: 255 }),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// 2. جدول المكونات (مثال: فراولة، حليب، سكر)
export const ingredients = mysqlTable("ingredients", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),
    categoryId: char("category_id", { length: 36 }).references(() => ingredientCategories.id).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("nameAr", { length: 255 }),
    inStock: boolean("in_stock").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// 3. جدول الربط (Junction Table) بين الأكلة والمكونات
export const foodIngredients = mysqlTable("food_ingredients", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    foodId: char("food_id", { length: 36 }).references(() => food.id).notNull(),
    ingredientId: char("ingredient_id", { length: 36 }).references(() => ingredients.id).notNull(),
    // 👇 (اختياري) لو عايز تسمح لليوزر يطلب الأكلة بدون المكون ده (زي "بدون بصل")
    isRemovable: boolean("is_removable").default(false),
    // هل هذا المكون أساسي لتوفر الأكلة؟ لو true، غياب المكون = الأكلة غير متاحة
    isEssential: boolean("is_essential").default(true).notNull(),
});