"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subcategories = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const Category_1 = require("./Category");
const restaurants_1 = require("./restaurants");
exports.subcategories = (0, mysql_core_1.mysqlTable)("subcategories", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }),
    categoryId: (0, mysql_core_1.char)("category_id", { length: 36 }).references(() => Category_1.categories.id).notNull(),
    addonsIds: (0, mysql_core_1.json)("addons_ids").$type().default([]),
    priority: (0, mysql_core_1.mysqlEnum)("priority", ["low", "medium", "high"]).default("low"),
    order_Level: (0, mysql_core_1.int)("order_level").default(0), // تم تغيير الاسم هنا
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
