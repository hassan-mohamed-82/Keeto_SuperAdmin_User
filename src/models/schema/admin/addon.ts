import{
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
    text
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { adonescategory } from "./adonescategory";
import { restaurants } from "./restaurants";

export const addons = mysqlTable("addons", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    price: varchar("price", { length: 255 }).notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active"),
    stock_type: mysqlEnum("stock_type", ["unlimited", "limited","daily"]).default("unlimited"),
    adonescategoryid: char("adonescategory_id", { length: 36 }).references(() => adonescategory.id).notNull(),
    restaurantid: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});