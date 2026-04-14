import {
    mysqlTable,
    varchar,
    timestamp,
    mysqlEnum,
    json,
    char,
    text,
    date
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ⚠️ تأكد من استيراد الجداول دي من مساراتها الصحيحة عندك
import { zones } from "./zone";
import { cuisines } from "./Cuisine ";

export const restaurants = mysqlTable("restaurants", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    // ==========================================
    // 1. Restaurant Info & Location (الصورة الأولى)
    // ==========================================
    name: varchar("name", { length: 255 }).notNull(),
    address: text("address").notNull(),
    
    // العلاقات (Relations)
    cuisineId: char("cuisine_id", { length: 36 }).references(() => cuisines.id),
    zoneId: char("zone_id", { length: 36 }).references(() => zones.id).notNull(),
 
    // الصور (Files/Images)
    logo: varchar("logo", { length: 255 }).notNull(),
    cover: varchar("cover", { length: 255 }),

    // ==========================================
    // 2. Delivery & Owner Info (الصورة الثانية)
    // ==========================================
    minDeliveryTime: varchar("min_delivery_time", { length: 50 }),
    maxDeliveryTime: varchar("max_delivery_time", { length: 50 }),
    deliveryTimeUnit: varchar("delivery_time_unit", { length: 50 }).default("Minutes"),

    // بيانات المالك (Owner Info)
    ownerFirstName: varchar("owner_first_name", { length: 255 }).notNull(),
    ownerLastName: varchar("owner_last_name", { length: 255 }).notNull(),
    ownerPhone: varchar("owner_phone", { length: 50 }).notNull(),

    // التاجز (Tags) - بنحفظها كـ Array داخل JSON
    tags: json("tags").$type<string[]>().default([]),

    // ==========================================
    // 3. Business TIN & Account Info (الصورة الثالثة)
    // ==========================================
    taxNumber: varchar("tax_number", { length: 255 }),
    taxExpireDate: date("tax_expire_date"), // date type for mm/dd/yyyy
    taxCertificate: varchar("tax_certificate", { length: 255 }), // مسار ملف الـ PDF/صورة

    // بيانات الدخول (Account Information)
    email: varchar("email", { length: 255 }).notNull().unique(),
    password: varchar("password", { length: 255 }).notNull(),
    // 💡 ملاحظة: حقل Confirm Password مش بيتسجل في الداتابيز، ده بيكون Validation في الـ Controller بس
     
    // Status & Timestamps
    // ==========================================
    status: mysqlEnum("status", ["active", "inactive", "pending"]).default("pending"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});