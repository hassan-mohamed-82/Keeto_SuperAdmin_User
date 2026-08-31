"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recommendedFoods = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const food_1 = require("./food");
const restaurants_1 = require("./restaurants");
exports.recommendedFoods = (0, mysql_core_1.mysqlTable)("recommended_foods", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull(),
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 })
        .references(() => food_1.food.id, { onDelete: "cascade" })
        .notNull(),
    recommendedFoodId: (0, mysql_core_1.char)("recommended_food_id", { length: 36 })
        .references(() => food_1.food.id, { onDelete: "cascade" })
        .notNull(),
    sortOrder: (0, mysql_core_1.int)("sort_order").default(0),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"])
        .default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
}, (table) => ({
    uniqueFoodRecommendationIdx: (0, mysql_core_1.uniqueIndex)("unique_food_recommendation_idx").on(table.foodId, table.recommendedFoodId),
}));
