import {
    mysqlTable,
    varchar,
    char,
    timestamp,
    decimal,
    mysqlEnum,
    int,
    boolean,
} from "drizzle-orm/mysql-core";
import { restaurants } from "./restaurants";
import { sql } from "drizzle-orm";

export const images = mysqlTable("images", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    restaurantid: char("restaurantid", { length: 36 })
        .references(() => restaurants.id)
        .notNull(),
    img: varchar("img", { length: 500 }).notNull(),
    periorty:int("periorty").default(0),
       createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
