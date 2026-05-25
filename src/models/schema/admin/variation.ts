import { int } from "drizzle-orm/mysql-core"; // تأكد من استدعاء int
import{
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
    boolean,
    text
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { food } from "./food";
// ... (جدول الـ food الأساسي كما هو) ...

// 1. جدول يمثل الـ Variation الواحد (مثل: الحجم، الإضافات)
export const foodVariations = mysqlTable("food_variations", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    foodId: char("food_id", { length: 36 }).references(() => food.id, { onDelete: "cascade" }).notNull(),
    
    name: varchar("name", { length: 255 }).notNull(), // اسم الفارييشن
    nameAr: varchar("name_ar", { length: 255 }).notNull().default(''),
    nameFr: varchar("name_fr", { length: 255 }).notNull().default(''),
    isRequired: boolean("is_required").default(false), // Required
    selectionType: mysqlEnum("selection_type", ["single", "multiple"]).default("single"), // Single vs Multiple
    min: int("min"), // Min
    max: int("max"), // Max
    status: boolean("status").default(true), // حالة الفارييشن (شغال / مقفول)
});

// 2. جدول يمثل الخيارات داخل كل Variation (مثل: صغير، وسط، كبير)
// 2. جدول يمثل الخيارات داخل كل Variation (مثل: صغير، وسط، كبير)
export const variationOptions = mysqlTable("variation_options", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    variationId: char("variation_id", { length: 36 }).references(() => foodVariations.id, { onDelete: "cascade" }).notNull(),
    
    optionName: varchar("option_name", { length: 255 }).notNull(),
    optionNameAr: varchar("option_name_ar", { length: 255 }).notNull().default(''),
    optionNameFr: varchar("option_name_fr", { length: 255 }).notNull().default(''),
    additionalPrice: varchar("additional_price", { length: 255 }).notNull().default("0"), 
    
    // 👇 الحقل الجديد للتحكم في الاختيار الافتراضي
    isDefault: boolean("is_default").default(false),
    
    status: boolean("status").default(true),
});

import { relations } from "drizzle-orm";

export const variationRelations = relations(foodVariations, ({ one, many }) => ({
    food: one(food, {
        fields: [foodVariations.foodId],
        references: [food.id],
    }),
    options: many(variationOptions),
}));

export const optionRelations = relations(variationOptions, ({ one }) => ({
    variation: one(foodVariations, {
        fields: [variationOptions.variationId],
        references: [foodVariations.id],
    }),
}));
