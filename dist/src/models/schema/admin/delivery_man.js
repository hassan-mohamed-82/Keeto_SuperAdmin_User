"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliveryMen = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
const schema_1 = require("../../schema");
exports.deliveryMen = (0, mysql_core_1.mysqlTable)("delivery_men", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id)
        .notNull(),
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 })
        .references(() => schema_1.branches.id),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    phone: (0, mysql_core_1.varchar)("phone", { length: 50 }).notNull(),
    email: (0, mysql_core_1.varchar)("email", { length: 255 }),
    password: (0, mysql_core_1.varchar)("password", { length: 255 }),
    image: (0, mysql_core_1.varchar)("image", { length: 500 }),
    isActive: (0, mysql_core_1.boolean)("is_active").default(true),
    isDeleted: (0, mysql_core_1.boolean)("is_deleted").default(false),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
