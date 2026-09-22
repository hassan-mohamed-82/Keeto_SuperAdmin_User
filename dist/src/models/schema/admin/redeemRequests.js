"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redeemRequests = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const food_1 = require("./food");
const restaurants_1 = require("./restaurants");
const Users_1 = require("../user/Users");
exports.redeemRequests = (0, mysql_core_1.mysqlTable)("redeem_requests", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 }).notNull().references(() => Users_1.users.id),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).notNull().references(() => restaurants_1.restaurants.id),
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 }).notNull().references(() => food_1.food.id),
    code: (0, mysql_core_1.varchar)("code", { length: 10 }).notNull().unique(),
    pointsDeducted: (0, mysql_core_1.int)("points_deducted").notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["pending", "used", "expired", "cancelled"]).default("pending"),
    expiresAt: (0, mysql_core_1.timestamp)("expires_at").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
