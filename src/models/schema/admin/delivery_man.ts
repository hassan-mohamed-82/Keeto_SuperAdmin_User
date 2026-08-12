import { mysqlTable, varchar, char, timestamp } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { branches } from "../../schema";

export const deliveryMen = mysqlTable("delivery_men", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id)
        .notNull(),

    branchId: char("branch_id", { length: 36 })
        .references(() => branches.id),

    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 50 }).notNull(),
    email: varchar("email", { length: 255 }),
    password: varchar("password", { length: 255 }),
    image: varchar("image", { length: 500 }),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
