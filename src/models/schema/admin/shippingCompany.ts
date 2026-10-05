import {
    mysqlTable,
    varchar,
    char,
    timestamp,
    mysqlEnum,
    text,
    decimal,
    json,
    int,
    time
} from "drizzle-orm/mysql-core";
import { sql, relations } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { deliveryMen } from "./delivery_man";
import { orders } from "./order";

// ==========================================
// 1. جدول شركات الشحن (Shipping Companies)
// ==========================================
export const shippingCompanies = mysqlTable("shipping_companies", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }),
    phone: varchar("phone", { length: 50 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    password: varchar("password", { length: 255 }).notNull(),
    address: text("address"),
    logo: varchar("logo", { length: 500 }),

    // إعدادات الـ Dispatching
    maxSearchRadius: decimal("max_search_radius", { precision: 6, scale: 2 }).default("10.00").notNull(), // أقصى مسافة (كم) بين فرع المطعم والمندوب عشان يدخل في الاختيار
    maxActiveOrders: int("max_active_orders").default(3).notNull(), // أقصى عدد أوردرات يشيلها المندوب في نفس الوقت
    maxAttempts: int("max_attempts").default(5).notNull(), // أقصى عدد محاولات تعيين للأوردر الواحد (بعد كل رفض)، بعدها manual_required
    commissionType: mysqlEnum("commission_type", ["percentage", "fixed"]).default("percentage").notNull(), // نوع العمولة: نسبة مئوية أو مبلغ ثابت
    commissionValue: decimal("commission_value", { precision: 10, scale: 2 }).default("0.00").notNull(), // قيمة العمولة (10 = 10% لو percentage، أو 10 جنيه لو fixed)

    status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// =========================================================================
// 2. مستخدمو شركة الشحن لتسجيل الدخول (Shipping Company Users - Login)
// =========================================================================
export const shippingCompanyUsers = mysqlTable("shipping_company_users", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    shippingCompanyId: char("shipping_company_id", { length: 36 })
        .references(() => shippingCompanies.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    password: varchar("password", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 50 }),
    role: mysqlEnum("role", ["admin", "dispatcher", "viewer"]).default("admin").notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// =========================================================================
// 3. المطاعم التابعة لشركة الشحن (Shipping Company Restaurants)
// =========================================================================
export const shippingCompanyRestaurants = mysqlTable("shipping_company_restaurants", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    shippingCompanyId: char("shipping_company_id", { length: 36 })
        .references(() => shippingCompanies.id, { onDelete: "cascade" })
        .notNull(),
    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// =========================================================================
// 4. مناطق التغطية الخاصة بشركة الشحن (Shipping Zones with Polygon & Fee)
// =========================================================================
export const shippingZones = mysqlTable("shipping_zones", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    shippingCompanyId: char("shipping_company_id", { length: 36 })
        .references(() => shippingCompanies.id, { onDelete: "cascade" })
        .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    nameAr: varchar("name_ar", { length: 255 }),
    // إحداثيات البوليجون: [{ lat: 30.01, lng: 31.2 }, ...]
    coordinates: json("coordinates").$type<{ lat: number; lng: number }[]>().notNull(),
    coverageAreaRadiusKm: decimal("coverage_area_radius_km", { precision: 6, scale: 2 }),
    deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }).default("0.00").notNull(),
    minOrderAmount: decimal("min_order_amount", { precision: 10, scale: 2 }).default("0.00").notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const shippingCompanyZones = shippingZones;

// =========================================================================
// 4. شفتات المندوب لخدمة مطعم معين (Delivery Man Shifts)
// للمناديب من نوع: workType = 'restaurant_shift'
// =========================================================================
export const deliveryManShifts = mysqlTable("delivery_man_shifts", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    deliveryManId: char("delivery_man_id", { length: 36 })
        .references(() => deliveryMen.id, { onDelete: "cascade" })
        .notNull(),
    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),
    dayOfWeek: int("day_of_week").notNull(), // 0 = الأحد, 1 = الإثنين, ..., 6 = السبت
    from: time("from").notNull(),
    to: time("to").notNull(),
    status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// =========================================================================
// 5. ربط المناديب بمناطق العمل الخاصة بشركة الشحن (Delivery Man Zones)
// =========================================================================
export const deliveryManZones = mysqlTable("delivery_man_zones", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    deliveryManId: char("delivery_man_id", { length: 36 })
        .references(() => deliveryMen.id, { onDelete: "cascade" })
        .notNull(),
    zoneId: char("zone_id", { length: 36 })
        .references(() => shippingZones.id, { onDelete: "cascade" })
        .notNull(),
    createdAt: timestamp("created_at").defaultNow(),
});

// =========================================================================
// 6. سجل توزيع الطلبات ومحاولات الإسناد (Dispatch Assignments / Offers Audit)
// =========================================================================
export const dispatchAssignments = mysqlTable("dispatch_assignments", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
    orderId: char("order_id", { length: 36 })
        .references(() => orders.id, { onDelete: "cascade" })
        .notNull(),
    shippingCompanyId: char("shipping_company_id", { length: 36 })
        .references(() => shippingCompanies.id, { onDelete: "cascade" })
        .notNull(),
    deliveryManId: char("delivery_man_id", { length: 36 })
        .references(() => deliveryMen.id, { onDelete: "cascade" })
        .notNull(),
    attemptNumber: int("attempt_number").default(1).notNull(),
    status: mysqlEnum("status", ["offered", "active", "rejected", "completed", "cancelled"]).default("active").notNull(),
    rejectReason: text("reject_reason"), // إجباري في حالة رفض المندوب للطلب
    offeredAt: timestamp("offered_at").defaultNow(),
    respondedAt: timestamp("responded_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

// ==========================================
// Drizzle Relations
// ==========================================
export const shippingCompaniesRelations = relations(shippingCompanies, ({ many }) => ({
    users: many(shippingCompanyUsers),
    zones: many(shippingZones),
    deliveryMen: many(deliveryMen),
    restaurants: many(shippingCompanyRestaurants),
}));

export const shippingCompanyRestaurantsRelations = relations(shippingCompanyRestaurants, ({ one }) => ({
    shippingCompany: one(shippingCompanies, {
        fields: [shippingCompanyRestaurants.shippingCompanyId],
        references: [shippingCompanies.id],
    }),
    restaurant: one(restaurants, {
        fields: [shippingCompanyRestaurants.restaurantId],
        references: [restaurants.id],
    }),
}));

export const shippingCompanyUsersRelations = relations(shippingCompanyUsers, ({ one }) => ({
    shippingCompany: one(shippingCompanies, {
        fields: [shippingCompanyUsers.shippingCompanyId],
        references: [shippingCompanies.id],
    }),
}));

export const shippingZonesRelations = relations(shippingZones, ({ one, many }) => ({
    shippingCompany: one(shippingCompanies, {
        fields: [shippingZones.shippingCompanyId],
        references: [shippingCompanies.id],
    }),
    courierZones: many(deliveryManZones),
}));

export const deliveryManShiftsRelations = relations(deliveryManShifts, ({ one }) => ({
    deliveryMan: one(deliveryMen, {
        fields: [deliveryManShifts.deliveryManId],
        references: [deliveryMen.id],
    }),
    restaurant: one(restaurants, {
        fields: [deliveryManShifts.restaurantId],
        references: [restaurants.id],
    }),
}));

export const deliveryManZonesRelations = relations(deliveryManZones, ({ one }) => ({
    deliveryMan: one(deliveryMen, {
        fields: [deliveryManZones.deliveryManId],
        references: [deliveryMen.id],
    }),
    zone: one(shippingZones, {
        fields: [deliveryManZones.zoneId],
        references: [shippingZones.id],
    }),
}));

export const dispatchAssignmentsRelations = relations(dispatchAssignments, ({ one }) => ({
    order: one(orders, {
        fields: [dispatchAssignments.orderId],
        references: [orders.id],
    }),
    shippingCompany: one(shippingCompanies, {
        fields: [dispatchAssignments.shippingCompanyId],
        references: [shippingCompanies.id],
    }),
    deliveryMan: one(deliveryMen, {
        fields: [dispatchAssignments.deliveryManId],
        references: [deliveryMen.id],
    }),
}));
