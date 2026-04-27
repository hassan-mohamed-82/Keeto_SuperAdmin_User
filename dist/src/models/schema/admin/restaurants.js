"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurants = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
// ⚠️ تأكد من استيراد الجداول دي من مساراتها الصحيحة عندك
const zone_1 = require("./zone");
const Cuisine_1 = require("./Cuisine ");
exports.restaurants = (0, mysql_core_1.mysqlTable)("restaurants", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    // ==========================================
    // 1. Restaurant Info & Location (الصورة الأولى)
    // ==========================================
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }).notNull().default(''),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }).notNull().default(''),
    address: (0, mysql_core_1.text)("address").notNull(),
    addressAr: (0, mysql_core_1.text)("address_ar").notNull().default(''),
    addressFr: (0, mysql_core_1.text)("address_fr").notNull().default(''),
    // العلاقات (Relations)
    cuisineId: (0, mysql_core_1.char)("cuisine_id", { length: 36 }).references(() => Cuisine_1.cuisines.id),
    zoneId: (0, mysql_core_1.char)("zone_id", { length: 36 }).references(() => zone_1.zones.id).notNull(),
    // الصور (Files/Images)
    logo: (0, mysql_core_1.varchar)("logo", { length: 500 }).notNull(),
    cover: (0, mysql_core_1.varchar)("cover", { length: 500 }),
    // ==========================================
    // 2. Delivery & Owner Info (الصورة الثانية)
    // ==========================================
    minDeliveryTime: (0, mysql_core_1.varchar)("min_delivery_time", { length: 50 }),
    maxDeliveryTime: (0, mysql_core_1.varchar)("max_delivery_time", { length: 50 }),
    deliveryTimeUnit: (0, mysql_core_1.varchar)("delivery_time_unit", { length: 50 }).default("Minutes"),
    // بيانات المالك (Owner Info)
    ownerFirstName: (0, mysql_core_1.varchar)("owner_first_name", { length: 255 }).notNull(),
    ownerLastName: (0, mysql_core_1.varchar)("owner_last_name", { length: 255 }).notNull(),
    ownerPhone: (0, mysql_core_1.varchar)("owner_phone", { length: 50 }).notNull(),
    // التاجز (Tags) - بنحفظها كـ Array داخل JSON
    tags: (0, mysql_core_1.json)("tags").$type().default([]),
    // ==========================================
    // 3. Business TIN & Account Info (الصورة الثالثة)
    // ==========================================
    taxNumber: (0, mysql_core_1.varchar)("tax_number", { length: 255 }),
    taxExpireDate: (0, mysql_core_1.date)("tax_expire_date"), // date type for mm/dd/yyyy
    taxCertificate: (0, mysql_core_1.varchar)("tax_certificate", { length: 255 }), // مسار ملف الـ PDF/صورة
    // بيانات الدخول (Account Information)
    email: (0, mysql_core_1.varchar)("email", { length: 255 }).notNull().unique(),
    password: (0, mysql_core_1.varchar)("password", { length: 255 }).notNull(),
    // 💡 ملاحظة: حقل Confirm Password مش بيتسجل في الداتابيز، ده بيكون Validation في الـ Controller بس
    type: (0, mysql_core_1.mysqlEnum)("type", ["restaurantadmin", "superadmin"]).default("restaurantadmin"),
    // Status & Timestamps
    // ==========================================
    addhome: (0, mysql_core_1.boolean)("addhome").default(false),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
