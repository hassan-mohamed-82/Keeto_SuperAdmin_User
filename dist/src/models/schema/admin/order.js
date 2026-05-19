"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderItems = exports.orders = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
const food_1 = require("./food");
const Users_1 = require("../user/Users");
// تم مسح الـ import الخاص بـ paymentMethods
const schema_1 = require("../../schema");
const address_1 = require("../user/address");
exports.orders = (0, mysql_core_1.mysqlTable)("orders", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    orderNumber: (0, mysql_core_1.varchar)("order_number", { length: 20 }).notNull().unique(),
    idempotencyKey: (0, mysql_core_1.varchar)("idempotency_key", { length: 100 }).unique(),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id)
        .notNull(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id)
        .notNull(),
    // 👇 ده الحقل اللي كان ناقص وعامل المشكلة
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 })
        .references(() => schema_1.branches.id)
        .notNull(),
    // 👇 عنوان التوصيل المختار من اليوزر
    addressId: (0, mysql_core_1.char)("address_id", { length: 36 })
        .references(() => address_1.addresses.id),
    orderSource: (0, mysql_core_1.mysqlEnum)("order_source", ["online_order", "food_aggregator", "mykeeto"]).notNull(),
    // onlineOrderType:mysqlEnum("online_order_type", ["app"]).default(),
    // 👇 التعديل هنا: شلنا الربط وخليناها Enum بتلات قيم بس
    paymentMethod: (0, mysql_core_1.mysqlEnum)("payment_method", ["cash_on_delivery", "visa", "wallet"]).notNull(),
    orderType: (0, mysql_core_1.mysqlEnum)("order_type", ["delivery", "takeaway", "dine_in"]).default("delivery"),
    subtotal: (0, mysql_core_1.decimal)("subtotal", { precision: 10, scale: 2 }).notNull(),
    deliveryFee: (0, mysql_core_1.decimal)("delivery_fee", { precision: 10, scale: 2 }).default("0.00"),
    serviceFee: (0, mysql_core_1.decimal)("service_fee", { precision: 10, scale: 2 }).default("0.00"),
    appCommission: (0, mysql_core_1.decimal)("app_commission", { precision: 10, scale: 2 }).default("0.00"),
    totalAmount: (0, mysql_core_1.decimal)("total_amount", { precision: 10, scale: 2 }).notNull(),
    // 👇 ضفنا حالة rejected هنا
    status: (0, mysql_core_1.mysqlEnum)("status", [
        "pending",
        "accepted",
        "preparing",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "rejected",
        "refund" // 👈 ضيف الكلمة دي هنا
    ]).default("pending"),
    // 👇 وده حقل سبب الإلغاء عشان المطعم يكتبه
    cancelReason: (0, mysql_core_1.text)("cancel_reason"),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
});
// ==========================================
// 3. جدول أصناف الأوردر (Order Items)
// ==========================================
exports.orderItems = (0, mysql_core_1.mysqlTable)("order_items", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    orderId: (0, mysql_core_1.char)("order_id", { length: 36 })
        .references(() => exports.orders.id)
        .notNull(),
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 })
        .references(() => food_1.food.id)
        .notNull(),
    quantity: (0, mysql_core_1.int)("quantity").notNull(),
    basePrice: (0, mysql_core_1.decimal)("base_price", { precision: 10, scale: 2 }).notNull(),
    variationsPrice: (0, mysql_core_1.decimal)("variations_price", { precision: 10, scale: 2 }).default("0.00"),
    totalPrice: (0, mysql_core_1.decimal)("total_price", { precision: 10, scale: 2 }).notNull(),
});
