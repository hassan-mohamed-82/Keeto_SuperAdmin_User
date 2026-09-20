import { mysqlTable, varchar, text, timestamp, mysqlEnum, json, char, time, longtext } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { subcategories } from "./subcategory";
import { food } from "./food";
import { discounts } from "./discount";

export const popup = mysqlTable("popup", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    Title: varchar("title", { length: 255 }).notNull(),
    TitleAr: varchar("title_ar", { length: 255 }),
    TitleFr: varchar("title_fr", { length: 255 }),
    description: varchar("description", { length: 500 }),
    descriptionAr: varchar("description_ar", { length: 500 }),
    descriptionFr: varchar("description_fr", { length: 500 }),
    image: longtext("image"),
    imageAr: longtext("image_ar"),
    imageFr: longtext("image_fr"),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id),

    type: mysqlEnum("type", ["web", "home_web", "home_app", "mykeeto_app"]).default("mykeeto_app"),
    linkType: mysqlEnum("link_type", ["link", "subcategory", "product", "discount"]).default("link"),
    link: varchar("link", { length: 500 }),
    subcategoryId: char("subcategory_id", { length: 36 }).references(() => subcategories.id, { onDelete: "set null" }),
    foodId: char("food_id", { length: 36 }).references(() => food.id, { onDelete: "set null" }),
    discountId: char("discount_id", { length: 36 }).references(() => discounts.id, { onDelete: "set null" }),

    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
