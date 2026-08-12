"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchMenuItems = exports.branches = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../../schema");
exports.branches = (0, mysql_core_1.mysqlTable)("branches", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    // مربوط بالمطعم الأساسي اللي إنت (كسوبر أدمن) لسه مكريته
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => schema_1.restaurants.id).notNull(),
    name: (0, mysql_core_1.varchar)("name", { length: 255 }).notNull(), // فرع مدينة نصر مثلاً
    nameAr: (0, mysql_core_1.varchar)("name_ar", { length: 255 }),
    nameFr: (0, mysql_core_1.varchar)("name_fr", { length: 255 }),
    address: (0, mysql_core_1.text)("address").notNull(),
    addressAr: (0, mysql_core_1.text)("address_ar"),
    addressFr: (0, mysql_core_1.text)("address_fr"),
    phoneNumber: (0, mysql_core_1.varchar)("phone_number", { length: 50 }),
    zoneId: (0, mysql_core_1.char)("zone_id", { length: 36 }).references(() => schema_1.zones.id).notNull(), // عشان منطقة توصيل الفرع ده
    cityId: (0, mysql_core_1.char)("city_id", { length: 36 }).references(() => schema_1.cities.id),
    deliveryRadiusKm: (0, mysql_core_1.decimal)("delivery_radius_km", { precision: 6, scale: 2 }).default("0"), lat: (0, mysql_core_1.varchar)("lat", { length: 255 }),
    lng: (0, mysql_core_1.varchar)("lng", { length: 255 }),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
exports.branchMenuItems = (0, mysql_core_1.mysqlTable)("branch_menu_items", {
    // 1. المعرف الأساسي
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    // ==========================================
    // 2. العلاقات (Relations) - أهم جزء
    // ==========================================
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 }).references(() => exports.branches.id).notNull(),
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 }).references(() => schema_1.food.id).notNull(),
    // ==========================================
    // 3. البيانات المتغيرة الخاصة بالفرع (Overrides)
    // ==========================================
    // السعر (ممكن يتغير من فرع لفرع لنفس الأكلة)
    price: (0, mysql_core_1.decimal)("price", { precision: 10, scale: 2 }).notNull(),
    // نوع المخزون (هل الفرع بيعمل عدد لا نهائي ولا كمية محدودة كل يوم؟)
    stockType: (0, mysql_core_1.mysqlEnum)("stock_type", ["limited", "unlimited"]).default("unlimited"),
    // الكمية المتاحة (لو نوع المخزون limited، الرقم ده هيقل مع كل أوردر)
    stockQty: (0, mysql_core_1.int)("stock_qty").default(0),
    // حالة الأكلة في الفرع ده تحديداً
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "out_of_stock", "inactive"]).default("active"),
    // ==========================================
    // 4. التواريخ
    // ==========================================
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
