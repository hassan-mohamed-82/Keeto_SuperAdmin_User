"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.users = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.users = (0, mysql_core_1.mysqlTable)("users", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    photo: (0, mysql_core_1.varchar)("photo", { length: 500 }),
    // ⚠️ التعديل هنا: شيلنا notNull() عشان فيس بوك ممكن ميرجعش إيميل
    email: (0, mysql_core_1.varchar)("email", { length: 255 }).unique(),
    // ⚠️ التعديل هنا: شيلنا notNull() عشان فيس بوك مش بيرجع رقم التليفون
    phone: (0, mysql_core_1.varchar)("phone", { length: 20 }),
    alternatePhone: (0, mysql_core_1.varchar)("alternate_phone", { length: 20 }),
    fcmToken: (0, mysql_core_1.text)("fcm_token"),
    // ⚠️ التعديل هنا: شيلنا notNull() لأن تسجيل الفيس بوك ملوش باسورد
    password: (0, mysql_core_1.varchar)("password", { length: 255 }),
    // أضف هذا السطر في تعريف جدول users في ملف schema.ts
    appleId: (0, mysql_core_1.varchar)("apple_id", { length: 255 }),
    // ✅ الحقل الجديد الخاص بالفيس بوك
    facebookId: (0, mysql_core_1.varchar)("facebook_id", { length: 255 }).unique(),
    googleId: (0, mysql_core_1.varchar)("google_id", { length: 255 }).unique(),
    isVerified: (0, mysql_core_1.boolean)("is_verified").default(false),
    isProfileComplete: (0, mysql_core_1.boolean)("is_profile_complete").default(false),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "blocked"]).default("active"),
    isDeleted: (0, mysql_core_1.boolean)("is_deleted").default(false),
    deletedAt: (0, mysql_core_1.timestamp)("deleted_at"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
