import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
    decimal,
    int,
    boolean,
    text
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { addons, categories, restaurants, subcategories } from "../../schema";
export const food = mysqlTable("food", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }).notNull().default(''),
    nameFr: varchar("name_fr", { length: 255 }).notNull().default(''),
    description: text("description").notNull(),
    descriptionAr: text("description_ar").notNull().default(''),
    descriptionFr: text("description_fr").notNull().default(''),
    image: varchar("image", { length: 255 }).notNull(),
    restaurantid: char("restaurantid", { length: 36 }).references(() => restaurants.id).notNull(),
    categoryid: char("categoryid", { length: 36 }).references(() => categories.id).notNull(),
    subcategoryid: char("subcategoryid", { length: 36 }).references(() => subcategories.id).notNull(),
    foodtype: mysqlEnum("foodtype", ["veg", "non-veg"]).default("veg"),
    Nutrition: text("nutrition"),
    allergen_ingredients: text("allergen_ingredients"), 
    is_Halal: boolean("is_Halal").default(false),
    addonsId: char("addons_id", { length: 36 }).references(() => addons.id),
    startTime: varchar("start_time", { length: 255 }).notNull(),
    endTime: varchar("end_time", { length: 255 }).notNull(),
    
    // 👇 ركز هنا: التأكد من الاسم الجديد بدون حرف الـ e
    search_tags: varchar("search_tags", { length: 255 }),

    // 👇 التأكد من الأنواع الجديدة DECIMAL و INT
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    discount_type: mysqlEnum("discount_type", ["percentage", "amount"]).default("percentage"),
    discount_value: decimal("discount_value", { precision: 10, scale: 2 }),
    Maximum_Purchase: int("Maximum_Purchase"),
    
    stock_type: mysqlEnum("stock_type", ["limited", "unlimited", "daily"]).default("unlimited"),
    variations: json("variations"), // العمود ده موجود دلوقتي في الصورة سطر 21

    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});