import {
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
import { addons, categories, restaurants, subcategories } from "../../schema";

export const food = mysqlTable("food", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").notNull(),
    image: varchar("image", { length: 255 }).notNull(),

    restaurantid: char("restaurantid", { length: 36 }).references(() => restaurants.id).notNull(),
    categoryid: char("categoryid", { length: 36 }).references(() => categories.id).notNull(),
    subcategoryid: char("subcategoryid", { length: 36 }).references(() => subcategories.id).notNull(),
    foodtype: mysqlEnum("foodtype", ["veg", "non-veg"]).default("veg"),
    Nutrition: text("nutrition"),
    
    // 👇 هنا تم الإصلاح: اسم المتغير في الكود يبقى كما هو، لكننا نخبر Drizzle أن اسم العمود الفعلي في الداتا بيز يكتب هكذا
    Allegren_Ingredients: text("allergen_ingredients"), 
    
    is_Halal: boolean("is_Halal").default(false),

    addonsId: char("addons_id", { length: 36 }).references(() => addons.id),
    startTime: varchar("start_time", { length: 255 }).notNull(),
    endTime: varchar("end_time", { length: 255 }).notNull(),
    
    // 👇 هذا العمود مطابق للداتا بيز فلا توجد به مشكلة
    search_tages: varchar("search_tages", { length: 255 }),

    price: varchar("price", { length: 255 }).notNull(),
    discount_type: mysqlEnum("discount_type", ["percentage", "amount"]).default("percentage"),
    discount_value: varchar("discount_value", { length: 255 }),
    Maximum_Purchase: varchar("Maximum_Purchase", { length: 255 }),
    stock_type: mysqlEnum("stock_type", ["limited", "unlimited", "daily"]).default("unlimited"),
    
    variations: json("variations"),

    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});