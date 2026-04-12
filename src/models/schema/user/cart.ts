import { mysqlTable, varchar, char, timestamp, decimal,  json, boolean, int } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { users } from "./Users";
import { food } from "../admin/food";
import { restaurants } from "../admin/restaurants";
export const cartItems = mysqlTable("cart_items", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    userId: char("user_id", { length: 36 }).references(() => users.id).notNull(),
    restaurantId: char("restaurant_id", { length: 36 }).references(() => restaurants.id).notNull(),
    foodId: char("food_id", { length: 36 }).references(() => food.id).notNull(),
    
    quantity: int("quantity").notNull().default(1),
    
    // لحفظ الإضافات أو الأحجام (مثل: لارج، مع صوص إضافي)
    variations: json("variations"), 
    
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});