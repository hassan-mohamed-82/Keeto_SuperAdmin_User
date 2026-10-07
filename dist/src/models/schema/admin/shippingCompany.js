"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchAssignmentsRelations = exports.deliveryManZonesRelations = exports.deliveryManShiftsRelations = exports.shippingZonesRelations = exports.shippingCompanyUsersRelations = exports.shippingCompanyRestaurantsRelations = exports.shippingCompaniesRelations = exports.dispatchAssignments = exports.deliveryManZones = exports.deliveryManShifts = exports.shippingCompanyZones = exports.shippingZones = exports.shippingCompanyRestaurants = exports.shippingCompanyUsers = exports.shippingCompanies = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
const delivery_man_1 = require("./delivery_man");
const order_1 = require("./order");
// ==========================================
// 1. جدول شركات الشحن (Shipping Companies)
// ==========================================
exports.shippingCompanies = (0, mysql_core_1.mysqlTable)("shipping_companies", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    phone: (0, mysql_core_1.varchar)("phone", { length: 50 }).notNull(),
    email: (0, mysql_core_1.varchar)("email", { length: 255 }).notNull().unique(),
    password: (0, mysql_core_1.varchar)("password", { length: 255 }).notNull(),
    address: (0, mysql_core_1.text)("address"),
    logo: (0, mysql_core_1.varchar)("logo", { length: 500 }),
    // إعدادات الـ Dispatching
    maxSearchRadius: (0, mysql_core_1.decimal)("max_search_radius", { precision: 6, scale: 2 }).default("10.00").notNull(), // أقصى مسافة (كم) بين فرع المطعم والمندوب عشان يدخل في الاختيار
    maxActiveOrders: (0, mysql_core_1.int)("max_active_orders").default(3).notNull(), // أقصى عدد أوردرات يشيلها المندوب في نفس الوقت
    maxAttempts: (0, mysql_core_1.int)("max_attempts").default(5).notNull(), // أقصى عدد محاولات تعيين للأوردر الواحد (بعد كل رفض)، بعدها manual_required
    commissionType: (0, mysql_core_1.mysqlEnum)("commission_type", ["percentage", "fixed"]).default("percentage").notNull(), // نوع العمولة: نسبة مئوية أو مبلغ ثابت
    commissionValue: (0, mysql_core_1.decimal)("commission_value", { precision: 10, scale: 2 }).default("0.00").notNull(), // قيمة العمولة (10 = 10% لو percentage، أو 10 جنيه لو fixed)
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// =========================================================================
// 2. مستخدمو شركة الشحن لتسجيل الدخول (Shipping Company Users - Login)
// =========================================================================
exports.shippingCompanyUsers = (0, mysql_core_1.mysqlTable)("shipping_company_users", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    shippingCompanyId: (0, mysql_core_1.char)("shipping_company_id", { length: 36 })
        .references(() => exports.shippingCompanies.id, { onDelete: "cascade" })
        .notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    email: (0, mysql_core_1.varchar)("email", { length: 255 }).notNull().unique(),
    password: (0, mysql_core_1.varchar)("password", { length: 255 }).notNull(),
    phone: (0, mysql_core_1.varchar)("phone", { length: 50 }),
    role: (0, mysql_core_1.mysqlEnum)("role", ["admin", "dispatcher", "viewer"]).default("admin").notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// =========================================================================
// 3. المطاعم التابعة لشركة الشحن (Shipping Company Restaurants)
// =========================================================================
exports.shippingCompanyRestaurants = (0, mysql_core_1.mysqlTable)("shipping_company_restaurants", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    shippingCompanyId: (0, mysql_core_1.char)("shipping_company_id", { length: 36 })
        .references(() => exports.shippingCompanies.id, { onDelete: "cascade" })
        .notNull(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// =========================================================================
// 4. مناطق التغطية الخاصة بشركة الشحن (Shipping Zones with Polygon & Fee)
// =========================================================================
exports.shippingZones = (0, mysql_core_1.mysqlTable)("shipping_zones", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    shippingCompanyId: (0, mysql_core_1.char)("shipping_company_id", { length: 36 })
        .references(() => exports.shippingCompanies.id, { onDelete: "cascade" })
        .notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(),
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    // إحداثيات البوليجون: [{ lat: 30.01, lng: 31.2 }, ...]
    coordinates: (0, mysql_core_1.json)("coordinates").$type().notNull(),
    coverageAreaRadiusKm: (0, mysql_core_1.decimal)("coverage_area_radius_km", { precision: 6, scale: 2 }),
    deliveryFee: (0, mysql_core_1.decimal)("delivery_fee", { precision: 10, scale: 2 }).default("0.00").notNull(),
    minOrderAmount: (0, mysql_core_1.decimal)("min_order_amount", { precision: 10, scale: 2 }).default("0.00").notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
exports.shippingCompanyZones = exports.shippingZones;
// =========================================================================
// 4. شفتات المندوب لخدمة مطعم معين (Delivery Man Shifts)
// للمناديب من نوع: workType = 'restaurant_shift'
// =========================================================================
exports.deliveryManShifts = (0, mysql_core_1.mysqlTable)("delivery_man_shifts", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    deliveryManId: (0, mysql_core_1.char)("delivery_man_id", { length: 36 })
        .references(() => delivery_man_1.deliveryMen.id, { onDelete: "cascade" })
        .notNull(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull(),
    dayOfWeek: (0, mysql_core_1.int)("day_of_week").notNull(), // 0 = الأحد, 1 = الإثنين, ..., 6 = السبت
    from: (0, mysql_core_1.time)("from").notNull(),
    to: (0, mysql_core_1.time)("to").notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// =========================================================================
// 5. ربط المناديب بمناطق العمل الخاصة بشركة الشحن (Delivery Man Zones)
// =========================================================================
exports.deliveryManZones = (0, mysql_core_1.mysqlTable)("delivery_man_zones", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    deliveryManId: (0, mysql_core_1.char)("delivery_man_id", { length: 36 })
        .references(() => delivery_man_1.deliveryMen.id, { onDelete: "cascade" })
        .notNull(),
    zoneId: (0, mysql_core_1.char)("zone_id", { length: 36 })
        .references(() => exports.shippingZones.id, { onDelete: "cascade" })
        .notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
// =========================================================================
// 6. سجل توزيع الطلبات ومحاولات الإسناد (Dispatch Assignments / Offers Audit)
// =========================================================================
exports.dispatchAssignments = (0, mysql_core_1.mysqlTable)("dispatch_assignments", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    orderId: (0, mysql_core_1.char)("order_id", { length: 36 })
        .references(() => order_1.orders.id, { onDelete: "cascade" })
        .notNull(),
    shippingCompanyId: (0, mysql_core_1.char)("shipping_company_id", { length: 36 })
        .references(() => exports.shippingCompanies.id, { onDelete: "cascade" })
        .notNull(),
    deliveryManId: (0, mysql_core_1.char)("delivery_man_id", { length: 36 })
        .references(() => delivery_man_1.deliveryMen.id, { onDelete: "cascade" })
        .notNull(),
    attemptNumber: (0, mysql_core_1.int)("attempt_number").default(1).notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", ["offered", "active", "rejected", "completed", "cancelled"]).default("active").notNull(),
    rejectReason: (0, mysql_core_1.text)("reject_reason"), // إجباري في حالة رفض المندوب للطلب
    offeredAt: (0, mysql_core_1.timestamp)("offered_at").defaultNow(),
    respondedAt: (0, mysql_core_1.timestamp)("responded_at"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
// ==========================================
// Drizzle Relations
// ==========================================
exports.shippingCompaniesRelations = (0, drizzle_orm_1.relations)(exports.shippingCompanies, ({ many }) => ({
    users: many(exports.shippingCompanyUsers),
    zones: many(exports.shippingZones),
    deliveryMen: many(delivery_man_1.deliveryMen),
    restaurants: many(exports.shippingCompanyRestaurants),
}));
exports.shippingCompanyRestaurantsRelations = (0, drizzle_orm_1.relations)(exports.shippingCompanyRestaurants, ({ one }) => ({
    shippingCompany: one(exports.shippingCompanies, {
        fields: [exports.shippingCompanyRestaurants.shippingCompanyId],
        references: [exports.shippingCompanies.id],
    }),
    restaurant: one(restaurants_1.restaurants, {
        fields: [exports.shippingCompanyRestaurants.restaurantId],
        references: [restaurants_1.restaurants.id],
    }),
}));
exports.shippingCompanyUsersRelations = (0, drizzle_orm_1.relations)(exports.shippingCompanyUsers, ({ one }) => ({
    shippingCompany: one(exports.shippingCompanies, {
        fields: [exports.shippingCompanyUsers.shippingCompanyId],
        references: [exports.shippingCompanies.id],
    }),
}));
exports.shippingZonesRelations = (0, drizzle_orm_1.relations)(exports.shippingZones, ({ one, many }) => ({
    shippingCompany: one(exports.shippingCompanies, {
        fields: [exports.shippingZones.shippingCompanyId],
        references: [exports.shippingCompanies.id],
    }),
    courierZones: many(exports.deliveryManZones),
}));
exports.deliveryManShiftsRelations = (0, drizzle_orm_1.relations)(exports.deliveryManShifts, ({ one }) => ({
    deliveryMan: one(delivery_man_1.deliveryMen, {
        fields: [exports.deliveryManShifts.deliveryManId],
        references: [delivery_man_1.deliveryMen.id],
    }),
    restaurant: one(restaurants_1.restaurants, {
        fields: [exports.deliveryManShifts.restaurantId],
        references: [restaurants_1.restaurants.id],
    }),
}));
exports.deliveryManZonesRelations = (0, drizzle_orm_1.relations)(exports.deliveryManZones, ({ one }) => ({
    deliveryMan: one(delivery_man_1.deliveryMen, {
        fields: [exports.deliveryManZones.deliveryManId],
        references: [delivery_man_1.deliveryMen.id],
    }),
    zone: one(exports.shippingZones, {
        fields: [exports.deliveryManZones.zoneId],
        references: [exports.shippingZones.id],
    }),
}));
exports.dispatchAssignmentsRelations = (0, drizzle_orm_1.relations)(exports.dispatchAssignments, ({ one }) => ({
    order: one(order_1.orders, {
        fields: [exports.dispatchAssignments.orderId],
        references: [order_1.orders.id],
    }),
    shippingCompany: one(exports.shippingCompanies, {
        fields: [exports.dispatchAssignments.shippingCompanyId],
        references: [exports.shippingCompanies.id],
    }),
    deliveryMan: one(delivery_man_1.deliveryMen, {
        fields: [exports.dispatchAssignments.deliveryManId],
        references: [delivery_man_1.deliveryMen.id],
    }),
}));
