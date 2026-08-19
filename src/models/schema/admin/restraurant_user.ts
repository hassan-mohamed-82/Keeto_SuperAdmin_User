// models/restaurantWallet.ts
import { mysqlTable, char, uniqueIndex } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { users } from "../user/Users";

export const restaurant_users = mysqlTable(
    "restaurant_users",
    {
        id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

        restaurantId: char("restaurant_id", { length: 36 })
            .references(() => restaurants.id)
            .notNull(),
            
        userId: char("user_id", { length: 36 })
            .references(() => users.id)
            .notNull(),
    },
    (table) => ({
        // 👈 إضافة قيود منع التكرار هنا
        unq: uniqueIndex("restaurant_user_idx").on(table.restaurantId, table.userId),
    })
);