"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restrauntadmin = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const rolesadmin_1 = require("./rolesadmin");
const restaurants_1 = require("./restaurants");
const branches_1 = require("./branches");
exports.restrauntadmin = (0, mysql_core_1.mysqlTable)("restrauntadmins", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(uuid())`),
    // الموظف ده تبع أنهي مطعم؟ وتبع أنهي فرع؟
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id).notNull(),
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 }).references(() => branches_1.branches.id),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    email: (0, mysql_core_1.varchar)("email", { length: 255 }).notNull().unique(),
    password: (0, mysql_core_1.varchar)("password", { length: 255 }).notNull(),
    phoneNumber: (0, mysql_core_1.varchar)("phone_number", { length: 255 }).notNull(),
    fcmToken: (0, mysql_core_1.text)("fcm_token"),
    type: (0, mysql_core_1.mysqlEnum)("type", ["subadmin", "branch_manager"]).notNull().default("branch_manager"),
    roleId: (0, mysql_core_1.char)("role_id", { length: 36 }).references(() => rolesadmin_1.rolesadmin.id),
    permissions: (0, mysql_core_1.json)("permissions").$type().default([]),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).notNull().default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
