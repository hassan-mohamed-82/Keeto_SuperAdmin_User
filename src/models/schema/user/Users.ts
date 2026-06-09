import { mysqlTable, varchar, text, timestamp, char, boolean, longtext, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { countries } from "../admin/country";
import { cities } from "../admin/city";
import { zones } from "../admin/zone";

export const users = mysqlTable("users", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    photo: varchar("photo", { length: 500 }),
    
    // ⚠️ التعديل هنا: شيلنا notNull() عشان فيس بوك ممكن ميرجعش إيميل
    email: varchar("email", { length: 255 }).unique(), 
    
    // ⚠️ التعديل هنا: شيلنا notNull() عشان فيس بوك مش بيرجع رقم التليفون
    phone: varchar("phone", { length: 20 }), 
    
    fcmToken: text("fcm_token"),
    
    // ⚠️ التعديل هنا: شيلنا notNull() لأن تسجيل الفيس بوك ملوش باسورد
    password: varchar("password", { length: 255 }), 
    
    // ✅ الحقل الجديد الخاص بالفيس بوك
    facebookId: varchar("facebook_id", { length: 255 }).unique(),

    googleId: varchar("google_id", { length: 255 }).unique(),
    
    isVerified: boolean("is_verified").default(false),
    status: mysqlEnum("status", ["active", "blocked"]).default("active"),
    createdAt: timestamp("created_at").defaultNow(),
});