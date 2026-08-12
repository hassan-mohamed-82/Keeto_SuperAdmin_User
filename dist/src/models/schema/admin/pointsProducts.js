"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pointsProducts = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
const food_1 = require("./food");
exports.pointsProducts = (0, mysql_core_1.mysqlTable)("points_products", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull(),
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 })
        .references(() => food_1.food.id, { onDelete: "cascade" })
        .notNull(),
    // النقاط المطلوبة لشراء/استبدال هذا المنتج مجاناً
    pointsRequiredForRedeem: (0, mysql_core_1.int)("points_required_for_redeem").default(0),
    isActive: (0, mysql_core_1.boolean)("is_active").default(true).notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
}, (table) => ({
    restFoodIdx: (0, mysql_core_1.uniqueIndex)("unique_restaurant_food_points").on(table.restaurantId, table.foodId),
}));
