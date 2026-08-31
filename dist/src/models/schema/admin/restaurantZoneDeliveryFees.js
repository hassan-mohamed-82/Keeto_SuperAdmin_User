"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurantZoneDeliveryFees = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const zone_1 = require("./zone");
const restaurants_1 = require("./restaurants");
const city_1 = require("./city");
const branches_1 = require("./branches");
exports.restaurantZoneDeliveryFees = (0, mysql_core_1.mysqlTable)("restaurant_zone_delivery_fees", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).references(() => restaurants_1.restaurants.id).notNull(),
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 }).references(() => branches_1.branches.id),
    zoneId: (0, mysql_core_1.char)("zone_id", { length: 36 }).references(() => zone_1.zones.id).notNull(),
    cityId: (0, mysql_core_1.char)("city_id", { length: 36 }).references(() => city_1.cities.id).notNull(),
    // نوع التغطية المعتمد للمطعم في هذه الزون (نقاط أو نصف قطر)
    coverageType: (0, mysql_core_1.mysqlEnum)("coverage_type", ["POLYGON", "RADIUS"]).default("POLYGON"),
    // الداتا المخصصة للمطعم (إذا عدل على الداتا الافتراضية المجلوبة من السوبر أدمن)
    customCoordinates: (0, mysql_core_1.json)("custom_coordinates").$type(),
    customRadiusKm: (0, mysql_core_1.decimal)("custom_radius_km", { precision: 8, scale: 2 }),
    // رسوم التوصيل والحد الأدنى للطلب الخاصين بالمطعم
    deliveryFee: (0, mysql_core_1.decimal)("delivery_fee", { precision: 10, scale: 2 }).notNull().default("0.00"),
    minOrderAmount: (0, mysql_core_1.decimal)("min_order_amount", { precision: 10, scale: 2 }).default("0.00"),
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
