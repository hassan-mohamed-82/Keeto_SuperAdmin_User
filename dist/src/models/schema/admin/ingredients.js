"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.foodIngredients = exports.ingredients = exports.ingredientCategories = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("../admin/restaurants");
const food_1 = require("../admin/food");
// 1. جدول تصنيفات المكونات (مثال: فواكه، ألبان، لحوم، بهارات)
exports.ingredientCategories = (0, mysql_core_1.mysqlTable)("ingredient_categories", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id).notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("nameAr", { length: 255 }),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// 2. جدول المكونات (مثال: فراولة، حليب، سكر)
exports.ingredients = (0, mysql_core_1.mysqlTable)("ingredients", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id).notNull(),
    categoryId: (0, mysql_core_1.char)("category_id", { length: 36 }).references(() => exports.ingredientCategories.id).notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("nameAr", { length: 255 }),
    inStock: (0, mysql_core_1.boolean)("in_stock").default(true),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// 3. جدول الربط (Junction Table) بين الأكلة والمكونات
exports.foodIngredients = (0, mysql_core_1.mysqlTable)("food_ingredients", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 }).references(() => food_1.food.id).notNull(),
    ingredientId: (0, mysql_core_1.char)("ingredient_id", { length: 36 }).references(() => exports.ingredients.id).notNull(),
    // 👇 (اختياري) لو عايز تسمح لليوزر يطلب الأكلة بدون المكون ده (زي "بدون بصل")
    isRemovable: (0, mysql_core_1.boolean)("is_removable").default(false),
    // هل هذا المكون أساسي لتوفر الأكلة؟ لو true، غياب المكون = الأكلة غير متاحة
    isEssential: (0, mysql_core_1.boolean)("is_essential").default(true).notNull(),
});
