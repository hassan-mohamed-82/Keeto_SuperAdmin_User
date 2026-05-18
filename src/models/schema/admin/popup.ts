import { mysqlTable, varchar, text, timestamp, mysqlEnum, json, char, time ,longtext } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "../../schema";

export const popup = mysqlTable("popup", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    Title: varchar("title", { length: 255 }).notNull(),
    TitleAr: varchar("title_ar", { length: 255 }),
    TitleFr:varchar("title_fr", { length: 255 }),
    description: varchar("description", { length: 500 }),
    descriptionAr: varchar("description_ar", { length: 500 }),
    descriptionFr: varchar("description_fr", { length: 500 }),
    image: varchar("image", { length: 500 }),
    imageAr: varchar("image_ar", { length: 500 }),
    imageFr: varchar("image_fr", { length: 500 }),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id),
   
    type: mysqlEnum("type", ["web","home_web","home_app","mykeeto_app"]).default("mykeeto_app"),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
