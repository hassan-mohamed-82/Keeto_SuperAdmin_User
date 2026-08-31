"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchIngredientLocks = exports.branchMenuItems = exports.branches = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../schema");
exports.branches = (0, mysql_core_1.mysqlTable)("branches", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => schema_1.restaurants.id).notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(), // فرع مدينة نصر مثلاً
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }),
    address: (0, mysql_core_1.text)("address").notNull(),
    addressAr: (0, mysql_core_1.text)("address_ar"),
    addressFr: (0, mysql_core_1.text)("address_fr"),
    phoneNumber: (0, mysql_core_1.varchar)("phone_number", { length: 50 }),
    zoneId: (0, mysql_core_1.char)("zone_id", { length: 36 }).references(() => schema_1.zones.id).notNull(),
    cityId: (0, mysql_core_1.char)("city_id", { length: 36 }).references(() => schema_1.cities.id),
    deliveryRadiusKm: (0, mysql_core_1.decimal)("delivery_radius_km", { precision: 6, scale: 2 }).default("0"),
    lat: (0, mysql_core_1.varchar)("lat", { length: 255 }),
    lng: (0, mysql_core_1.varchar)("lng", { length: 255 }),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
exports.branchMenuItems = (0, mysql_core_1.mysqlTable)("branch_menu_items", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 }).references(() => exports.branches.id).notNull(),
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 }).references(() => schema_1.food.id).notNull(),
    // السعر اختياري: إذا كان NULL يعتمد basePrice من جدول food
    price: (0, mysql_core_1.decimal)("price", { precision: 10, scale: 2 }),
    stockType: (0, mysql_core_1.mysqlEnum)("stock_type", ["limited", "unlimited"]).default("unlimited"),
    stockQty: (0, mysql_core_1.int)("stock_qty").default(0),
    // حالة الأكلة يدويًا في هذا الفرع (نشط أو موقوف بقرار مدير الفرع)
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// ===================================================
// جدول قفل وتوفر المكونات per-branch (عام أو لمنتج معين)
// ===================================================
exports.branchIngredientLocks = (0, mysql_core_1.mysqlTable)("branch_ingredient_locks", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 })
        .references(() => exports.branches.id)
        .notNull(),
    // إذا كانت NULL -> القفل يطبق على المكون في الفرع ككل (لكل الوجبات)
    // إذا كانت بها UUID -> القفل يطبق على هذا المكون لهذه الوجبة فقط داخل هذا الفرع
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 })
        .references(() => schema_1.food.id),
    ingredientId: (0, mysql_core_1.char)("ingredient_id", { length: 36 })
        .references(() => schema_1.ingredients.id)
        .notNull(),
    // false = المكون غير متاح
    isAvailable: (0, mysql_core_1.boolean)("is_available").default(true).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
