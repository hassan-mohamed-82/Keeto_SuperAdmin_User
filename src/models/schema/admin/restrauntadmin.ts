import { mysqlTable, varchar, char, timestamp, mysqlEnum, json , text } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { rolesadmin } from "./rolesadmin";
import { Permission } from "../../../types/custom";
import { restaurants } from "./restaurants";
import { branches } from "./branches";

export const restrauntadmin = mysqlTable("restrauntadmins", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(uuid())`),

    fcmToken: text("fcm_token"),

    // الموظف ده تبع أنهي مطعم؟ (إجباري للكل)
    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),

    // تبع أنهي فرع؟ 
    // لو الـ type هو owner أو subadmin عام للمطعم -> بيبقا null (يشوف كل الفروع)
    // لو الـ type هو branch_manager أو staff -> لازم يتربط بفرع محدد
    branchId: char("branch_id", { length: 36 }).references(() => branches.id, { onDelete: "set null" }),

    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    password: varchar("password", { length: 255 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 255 }).notNull(),

    // هيكل الأدوار واضح ومحدد
    type: mysqlEnum("type", ["owner", "subadmin", "branch_manager", "staff"])
        .notNull()
        .default("branch_manager"),

    // نظام الصلاحيات المفضل (عبر الـ Role)
    roleId: char("role_id", { length: 36 }).references(() => rolesadmin.id),
    
    // اختياري: لو حابة تدي صلاحيات استثنائية مخصصة للشخص ده برضه بره الرول العامة بتاعته
    permissions: json("permissions").$type<Permission[]>().default([]),
    status: mysqlEnum("status", ["active", "inactive"]).notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});