"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restaurantSchedules = exports.restaurantSettings = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
// 1. جدول الإعدادات العامة
exports.restaurantSettings = (0, mysql_core_1.mysqlTable)("restaurant_settings", {
    id: (0, mysql_core_1.int)("id").autoincrement().primaryKey(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).notNull().unique(),
    foodManagement: (0, mysql_core_1.boolean)("food_management").default(true),
    scheduledDelivery: (0, mysql_core_1.boolean)("scheduled_delivery").default(false),
    reviewsSection: (0, mysql_core_1.boolean)("reviews_section").default(true),
    posSection: (0, mysql_core_1.boolean)("pos_section").default(false),
    selfDelivery: (0, mysql_core_1.boolean)("self_delivery").default(false),
    homeDelivery: (0, mysql_core_1.boolean)("home_delivery").default(true),
    takeaway: (0, mysql_core_1.boolean)("takeaway").default(false),
    orderSubscription: (0, mysql_core_1.boolean)("order_subscription").default(false),
    instantOrder: (0, mysql_core_1.boolean)("instant_order").default(false),
    halalTagStatus: (0, mysql_core_1.boolean)("halal_tag_status").default(false),
    dineIn: (0, mysql_core_1.boolean)("dine_in").default(false),
    firstColor: (0, mysql_core_1.varchar)("first_color", { length: 20 }),
    secondColor: (0, mysql_core_1.varchar)("second_color", { length: 20 }),
    vegType: (0, mysql_core_1.mysqlEnum)("veg_type", ["VEG", "NON_VEG", "BOTH"]).default("BOTH"),
    canEditOrder: (0, mysql_core_1.boolean)("can_edit_order").default(false),
    minOrderAmount: (0, mysql_core_1.decimal)("min_order_amount", { precision: 10, scale: 2 }).default("0.00"),
    minDeliveryTime: (0, mysql_core_1.int)("min_delivery_time").default(15),
    maxDeliveryTime: (0, mysql_core_1.int)("max_delivery_time").default(25),
    isAlwaysOpen: (0, mysql_core_1.boolean)("is_always_open").default(false),
    isSameTimeEveryDay: (0, mysql_core_1.boolean)("is_same_time_every_day").default(false),
    isTemporarilyClosed: (0, mysql_core_1.boolean)("is_temporarily_closed").default(false),
});
// 2. جدول مواعيد العمل (يدعم الفترات المتعددة)
exports.restaurantSchedules = (0, mysql_core_1.mysqlTable)("restaurant_schedules", {
    id: (0, mysql_core_1.int)("id").autoincrement().primaryKey(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 }).notNull(),
    dayOfWeek: (0, mysql_core_1.int)("day_of_week").notNull(), // 0 = الأحد, 1 = الإثنين ... 6 = السبت
    isOffDay: (0, mysql_core_1.boolean)("is_off_day").default(false),
    openingTime: (0, mysql_core_1.varchar)("opening_time", { length: 5 }), // مثلاً: "09:00"
    closingTime: (0, mysql_core_1.varchar)("closing_time", { length: 5 }), // مثلاً: "23:00"
});
