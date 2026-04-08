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
    isRequired: boolean("is_required").default(false), // Required
    selectionType: mysqlEnum("selection_type", ["single", "multiple"]).default("single"), // Single vs Multiple
    min: int("min"), // Min
    max: int("max"), // Max
});

// 2. جدول يمثل الخيارات داخل كل Variation (مثل: صغير، وسط، كبير)
export const variationOptions = mysqlTable("variation_options", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    variationId: char("variation_id", { length: 36 }).references(() => foodVariations.id, { onDelete: "cascade" }).notNull(),
    
    optionName: varchar("option_name", { length: 255 }).notNull(), // Option name
    additionalPrice: varchar("additional_price", { length: 255 }).notNull().default("0"), // Additional price
});