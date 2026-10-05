import { mysqlTable, varchar, char, timestamp, boolean, mysqlEnum, text, int } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { branches } from "../../schema";
import { shippingCompanies } from "./shippingCompany";

export const deliveryMen = mysqlTable("delivery_men", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    // في حالة كان تابع لمطعم معين
    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "set null" }),

    // في حالة كان تابع لشركة شحن (Outsource)
    shippingCompanyId: char("shipping_company_id", { length: 36 })
        .references(() => shippingCompanies.id, { onDelete: "set null" }),

    branchId: char("branch_id", { length: 36 })
        .references(() => branches.id, { onDelete: "set null" }),

    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 50 }).notNull(),
    email: varchar("email", { length: 255 }),
    password: varchar("password", { length: 255 }),
    image: varchar("image", { length: 500 }),

    // نوع التوصيل: لمطعم محدد أم لشركة شحن خارجية (outsource)
    deliveryType: mysqlEnum("delivery_type", ["restaurant", "outsource"]).default("restaurant").notNull(),

    // طبيعة العمل: شيفت لمطعم محدد في أوقات معينة أم outsource عام لشركة الشحن
    workType: mysqlEnum("work_type", ["restaurant_shift", "outsource"]).default("outsource").notNull(),

    // عدد الطلبات النشطة حالياً عند المندوب
    activeOrdersCount: int("active_orders_count").default(0).notNull(),

    // حالة الشفت (نشط / غير نشط)
    shiftStatus: mysqlEnum("shift_status", ["active", "inactive"]).default("inactive").notNull(),

    // متصل بالإنترنت واستقبال الطلبات
    isOnline: boolean("is_online").default(false).notNull(),
    isAvailable: boolean("is_available").default(true).notNull(),

    // أحدث إحداثيات موقع المندوب في الوقت الفعلي عبر WebSocket
    currentLat: varchar("current_lat", { length: 50 }),
    currentLng: varchar("current_lng", { length: 50 }),
    lastLocationUpdate: timestamp("last_location_update"),

    fcmToken: text("fcm_token"),

    isActive: boolean("is_active").default(true),
    isDeleted: boolean("is_deleted").default(false),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
