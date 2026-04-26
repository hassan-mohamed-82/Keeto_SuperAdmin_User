import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
    text
, longtext } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
export const cuisines = mysqlTable("cuisines", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }).notNull().default(''),
    nameFr: varchar("name_fr", { length: 255 }).notNull().default(''),
    Image: varchar("image", { length: 500 }).notNull(),
    meta_image: varchar("meta_image", { length: 500 }),
    description: text("description"),
    descriptionAr: text("description_ar").notNull().default(''),
    descriptionFr: text("description_fr").notNull().default(''),
    meta_description: text("meta_description"),
    meta_descriptionAr: text("meta_description_ar").notNull().default(''),
    meta_descriptionFr: text("meta_description_fr").notNull().default(''),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    total_restaurants: varchar("total_restaurants", { length: 255 }).default("0"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});