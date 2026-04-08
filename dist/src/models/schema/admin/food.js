"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.food = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../schema");
exports.food = (0, mysql_core_1.mysqlTable)("food", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    description: (0, mysql_core_1.text)("description").notNull(),
    image: (0, mysql_core_1.varchar)("image", { length: 255 }).notNull(),
    restaurantid: (0, mysql_core_1.char)("restaurantid", { length: 36 }).references(() => schema_1.restaurants.id).notNull(),
    categoryid: (0, mysql_core_1.char)("categoryid", { length: 36 }).references(() => schema_1.categories.id).notNull(),
    subcategoryid: (0, mysql_core_1.char)("subcategoryid", { length: 36 }).references(() => schema_1.subcategories.id).notNull(),
    foodtype: (0, mysql_core_1.mysqlEnum)("foodtype", ["veg", "non-veg"]).default("veg"),
    Nutrition: (0, mysql_core_1.text)("nutrition"),
    Allegren_Ingredients: (0, mysql_core_1.text)("allegren_ingredients"),
    is_Halal: (0, mysql_core_1.boolean)("is_Halal").default(false),
    addonsId: (0, mysql_core_1.char)("addons_id", { length: 36 }).references(() => schema_1.addons.id),
    startTime: (0, mysql_core_1.varchar)("start_time", { length: 255 }).notNull(),
    endTime: (0, mysql_core_1.varchar)("end_time", { length: 255 }).notNull(),
    search_tages: (0, mysql_core_1.varchar)("search_tages", { length: 255 }),
    price: (0, mysql_core_1.varchar)("price", { length: 255 }).notNull(),
    discount_type: (0, mysql_core_1.mysqlEnum)("discount_type", ["percentage", "amount"]).default("percentage"),
    discount_value: (0, mysql_core_1.varchar)("discount_value", { length: 255 }),
    Maximum_Purchase: (0, mysql_core_1.varchar)("Maximum_Purchase", { length: 255 }),
    stock_type: (0, mysql_core_1.mysqlEnum)("stock_type", ["limited", "unlimited", "daily"]).default("unlimited"),
    variations: (0, mysql_core_1.json)("variations"),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
