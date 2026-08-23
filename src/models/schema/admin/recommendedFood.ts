import {
    mysqlTable,
    char,
    timestamp,
    mysqlEnum,
    int,
    uniqueIndex
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { food } from "./food";
import { restaurants } from "./restaurants";

export const recommendedFoods = mysqlTable("recommended_foods", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),

    foodId: char("food_id", { length: 36 })
        .references(() => food.id, { onDelete: "cascade" })
        .notNull(),

    recommendedFoodId: char("recommended_food_id", { length: 36 })
        .references(() => food.id, { onDelete: "cascade" })
        .notNull(),

    sortOrder: int("sort_order").default(0),

    status: mysqlEnum("status", ["active", "inactive"])
        .default("active"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
}, (table) => ({
    uniqueFoodRecommendationIdx: uniqueIndex("unique_food_recommendation_idx").on(table.foodId, table.recommendedFoodId),
}));
