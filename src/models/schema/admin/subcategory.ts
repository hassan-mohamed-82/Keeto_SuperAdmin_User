import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
    int,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { categories } from "./Category";
import { restaurants } from "./restaurants";

export const subcategories = mysqlTable("subcategories", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }),
    nameFr: varchar("name_fr", { length: 255 }),
    categoryId: char("category_id", { length: 36 }).references(() => categories.id).notNull(),
    addonsIds: json("addons_ids").$type<string[]>().default([]),
    priority: mysqlEnum("priority", ["low", "medium", "high"]).default("low"),
    order_Level: int("order_level").default(0), // تم تغيير الاسم هنا
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});