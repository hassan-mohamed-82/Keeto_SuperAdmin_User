import {
    mysqlTable,
    char,
    boolean,
    timestamp,
    int,
    uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { food } from "./food";

export const pointsProducts = mysqlTable("points_products", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),

    foodId: char("food_id", { length: 36 })
        .references(() => food.id, { onDelete: "cascade" })
        .notNull(),

    // النقاط المطلوبة لشراء/استبدال هذا المنتج مجاناً
    pointsRequiredForRedeem: int("points_required_for_redeem").default(0),

    isActive: boolean("is_active").default(true).notNull(),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (table) => ({
    restFoodIdx: uniqueIndex("unique_restaurant_food_points").on(table.restaurantId, table.foodId),
}));