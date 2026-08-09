import { mysqlTable, varchar, char, timestamp, decimal,  json, boolean, int } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "./Users";
import { food } from "../admin/food";
import { restaurants } from "../admin/restaurants";
export const cartItems = mysqlTable("cart_items", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    userId: char("user_id", { length: 36 })
        .references(() => users.id)
        .notNull(),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id)
        .notNull(),

    foodId: char("food_id", { length: 36 })
        .references(() => food.id)
        .notNull(),

    quantity: int("quantity").notNull().default(1),

    // 🔥 snapshot السعر وقت الإضافة
    unitPrice: varchar("unit_price", { length: 50 }).notNull(),

    // 🔥 السعر الإجمالي (unitPrice * quantity)
    totalPrice: varchar("total_price", { length: 50 }).notNull(),

    variations: json("variations"),

    addons: json("addons"),

    note: varchar("note", { length: 500 }),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});