"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deliveryMen = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
const schema_1 = require("../../schema");
const shippingCompany_1 = require("./shippingCompany");
exports.deliveryMen = (0, mysql_core_1.mysqlTable)("delivery_men", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    // في حالة كان تابع لمطعم معين
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "set null" }),
    // في حالة كان تابع لشركة شحن (Outsource)
    shippingCompanyId: (0, mysql_core_1.char)("shipping_company_id", { length: 36 })
        .references(() => shippingCompany_1.shippingCompanies.id, { onDelete: "set null" }),
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 })
        .references(() => schema_1.branches.id, { onDelete: "set null" }),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    phone: (0, mysql_core_1.varchar)("phone", { length: 50 }).notNull(),
    email: (0, mysql_core_1.varchar)("email", { length: 255 }),
    password: (0, mysql_core_1.varchar)("password", { length: 255 }),
    image: (0, mysql_core_1.varchar)("image", { length: 500 }),
    // نوع التوصيل: لمطعم محدد أم لشركة شحن خارجية (outsource)
    deliveryType: (0, mysql_core_1.mysqlEnum)("delivery_type", ["restaurant", "outsource"]).default("restaurant").notNull(),
    // طبيعة العمل: شيفت لمطعم محدد في أوقات معينة أم outsource عام لشركة الشحن
    workType: (0, mysql_core_1.mysqlEnum)("work_type", ["restaurant_shift", "outsource"]).default("outsource").notNull(),
    // عدد الطلبات النشطة حالياً عند المندوب
    activeOrdersCount: (0, mysql_core_1.int)("active_orders_count").default(0).notNull(),
    // حالة الشفت (نشط / غير نشط)
    shiftStatus: (0, mysql_core_1.mysqlEnum)("shift_status", ["active", "inactive"]).default("inactive").notNull(),
    // متصل بالإنترنت واستقبال الطلبات
    isOnline: (0, mysql_core_1.boolean)("is_online").default(false).notNull(),
    isAvailable: (0, mysql_core_1.boolean)("is_available").default(true).notNull(),
    // أحدث إحداثيات موقع المندوب في الوقت الفعلي عبر WebSocket
    currentLat: (0, mysql_core_1.varchar)("current_lat", { length: 50 }),
    currentLng: (0, mysql_core_1.varchar)("current_lng", { length: 50 }),
    lastLocationUpdate: (0, mysql_core_1.timestamp)("last_location_update"),
    fcmToken: (0, mysql_core_1.text)("fcm_token"),
    isActive: (0, mysql_core_1.boolean)("is_active").default(true),
    isDeleted: (0, mysql_core_1.boolean)("is_deleted").default(false),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
