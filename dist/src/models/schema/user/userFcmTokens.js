"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userFcmTokens = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const Users_1 = require("./Users");
const restaurants_1 = require("../admin/restaurants");
exports.userFcmTokens = (0, mysql_core_1.mysqlTable)("user_fcm_tokens", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id, { onDelete: "cascade" })
        .notNull(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" }),
    fcmToken: (0, mysql_core_1.text)("fcm_token").notNull(),
    deviceType: (0, mysql_core_1.mysqlEnum)("device_type", ["web", "android", "ios"]).default("android"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow()
}, (table) => ({
    userRestaurantTokenIdx: (0, mysql_core_1.uniqueIndex)("unique_user_restaurant_token").on(table.userId, table.restaurantId),
}));
