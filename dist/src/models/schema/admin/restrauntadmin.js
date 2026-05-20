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
    fcmToken: (0, mysql_core_1.text)("fcm_token"),
    // الموظف ده تبع أنهي مطعم؟ (إجباري للكل)
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull(),
    // تبع أنهي فرع؟ 
    // لو الـ type هو owner أو subadmin عام للمطعم -> بيبقا null (يشوف كل الفروع)
    // لو الـ type هو branch_manager أو staff -> لازم يتربط بفرع محدد
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 }).references(() => branches_1.branches.id, { onDelete: "set null" }),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    email: (0, mysql_core_1.varchar)("email", { length: 255 }).notNull().unique(),
    password: (0, mysql_core_1.varchar)("password", { length: 255 }).notNull(),
    phoneNumber: (0, mysql_core_1.varchar)("phone_number", { length: 255 }).notNull(),
    // هيكل الأدوار واضح ومحدد
    type: (0, mysql_core_1.mysqlEnum)("type", ["owner", "subadmin", "branch_manager", "staff"])
        .notNull()
        .default("branch_manager"),
    // نظام الصلاحيات المفضل (عبر الـ Role)
    roleId: (0, mysql_core_1.char)("role_id", { length: 36 }).references(() => rolesadmin_1.rolesadmin.id),
    // اختياري: لو حابة تدي صلاحيات استثنائية مخصصة للشخص ده برضه بره الرول العامة بتاعته
    permissions: (0, mysql_core_1.json)("permissions").$type().default([]),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).notNull().default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
