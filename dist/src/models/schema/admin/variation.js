"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.variationOptions = exports.foodVariations = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core"); // تأكد من استدعاء int
const mysql_core_2 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const food_1 = require("./food");
// ... (جدول الـ food الأساسي كما هو) ...
// 1. جدول يمثل الـ Variation الواحد (مثل: الحجم، الإضافات)
exports.foodVariations = (0, mysql_core_2.mysqlTable)("food_variations", {
    id: (0, mysql_core_2.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    foodId: (0, mysql_core_2.char)("food_id", { length: 36 }).references(() => food_1.food.id, { onDelete: "cascade" }).notNull(),
    name: (0, mysql_core_2.varchar)("name", { length: 255 }).notNull(), // اسم الفارييشن
    isRequired: (0, mysql_core_2.boolean)("is_required").default(false), // Required
    selectionType: (0, mysql_core_2.mysqlEnum)("selection_type", ["single", "multiple"]).default("single"), // Single vs Multiple
    min: (0, mysql_core_1.int)("min"), // Min
    max: (0, mysql_core_1.int)("max"), // Max
});
// 2. جدول يمثل الخيارات داخل كل Variation (مثل: صغير، وسط، كبير)
exports.variationOptions = (0, mysql_core_2.mysqlTable)("variation_options", {
    id: (0, mysql_core_2.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    variationId: (0, mysql_core_2.char)("variation_id", { length: 36 }).references(() => exports.foodVariations.id, { onDelete: "cascade" }).notNull(),
    optionName: (0, mysql_core_2.varchar)("option_name", { length: 255 }).notNull(), // Option name
    additionalPrice: (0, mysql_core_2.varchar)("additional_price", { length: 255 }).notNull().default("0"), // Additional price
});
