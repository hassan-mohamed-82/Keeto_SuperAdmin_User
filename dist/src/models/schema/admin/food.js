"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.food = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../schema");
exports.food = (0, mysql_core_1.mysqlTable)("food", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }).notNull().default(''),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }).notNull().default(''),
    description: (0, mysql_core_1.text)("description").notNull(),
    descriptionAr: (0, mysql_core_1.text)("description_ar").notNull().default(''),
    descriptionFr: (0, mysql_core_1.text)("description_fr").notNull().default(''),
    image: (0, mysql_core_1.varchar)("image", { length: 500 }).notNull(),
    restaurantid: (0, mysql_core_1.char)("restaurantid", { length: 36 }).references(() => schema_1.restaurants.id).notNull(),
    categoryid: (0, mysql_core_1.char)("categoryid", { length: 36 }).references(() => schema_1.categories.id).notNull(),
    subcategoryid: (0, mysql_core_1.char)("subcategoryid", { length: 36 }).references(() => schema_1.subcategories.id).notNull(),
    foodtype: (0, mysql_core_1.mysqlEnum)("foodtype", ["veg", "non-veg"]).default("veg"),
    Nutrition: (0, mysql_core_1.text)("nutrition"),
    allergen_ingredients: (0, mysql_core_1.text)("allergen_ingredients"),
    is_Halal: (0, mysql_core_1.boolean)("is_Halal").default(false),
    addonsId: (0, mysql_core_1.char)("addons_id", { length: 36 }).references(() => schema_1.addons.id),
    startTime: (0, mysql_core_1.varchar)("start_time", { length: 255 }).notNull(),
    endTime: (0, mysql_core_1.varchar)("end_time", { length: 255 }).notNull(),
    // 👇 ركز هنا: التأكد من الاسم الجديد بدون حرف الـ e
    search_tags: (0, mysql_core_1.varchar)("search_tags", { length: 255 }),
    // 👇 التأكد من الأنواع الجديدة DECIMAL و INT
    price: (0, mysql_core_1.decimal)("price", { precision: 10, scale: 2 }).notNull(),
    discount_type: (0, mysql_core_1.mysqlEnum)("discount_type", ["percentage", "amount"]).default("percentage"),
    discount_value: (0, mysql_core_1.decimal)("discount_value", { precision: 10, scale: 2 }),
    Maximum_Purchase: (0, mysql_core_1.int)("Maximum_Purchase"),
    stock_type: (0, mysql_core_1.mysqlEnum)("stock_type", ["limited", "unlimited", "daily"]).default("unlimited"),
    variations: (0, mysql_core_1.json)("variations"), // العمود ده موجود دلوقتي في الصورة سطر 21
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
