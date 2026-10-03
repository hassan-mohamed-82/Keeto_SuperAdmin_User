"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentTransactionsRelations = exports.paymentTransactions = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const order_1 = require("./order");
const restaurants_1 = require("./restaurants");
const Users_1 = require("../user/Users");
// ==========================================
// جدول سجل معاملات بوابات الدفع (Payment Transactions)
// ==========================================
exports.paymentTransactions = (0, mysql_core_1.mysqlTable)("payment_transactions", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    orderId: (0, mysql_core_1.char)("order_id", { length: 36 })
        .references(() => order_1.orders.id, { onDelete: "set null" }),
    orderNumber: (0, mysql_core_1.varchar)("order_number", { length: 50 }),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id, { onDelete: "set null" }),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "set null" }),
    gateway: (0, mysql_core_1.mysqlEnum)("gateway", ["kashier", "paymob", "geidea"]).notNull(),
    // المعرف الخاص بالمعاملة من البوابة (مثل transaction id)
    transactionId: (0, mysql_core_1.varchar)("transaction_id", { length: 150 }),
    // المعرف الخاص بالأوردر لدى البوابة (مثل paymob order_id أو kashier orderId / sessionId)
    gatewayOrderId: (0, mysql_core_1.varchar)("gateway_order_id", { length: 150 }),
    amount: (0, mysql_core_1.decimal)("amount", { precision: 10, scale: 2 }).notNull(),
    currency: (0, mysql_core_1.varchar)("currency", { length: 10 }).default("EGP"),
    status: (0, mysql_core_1.mysqlEnum)("status", ["pending", "success", "failed"]).default("pending").notNull(),
    // سبب الفشل أو رسالة الخطأ القادمة من البوابة
    failureReason: (0, mysql_core_1.text)("failure_reason"),
    // الـ Payload / Webhook Data بالكامل للرجوع إليه وتتبعه
    rawResponse: (0, mysql_core_1.json)("raw_response"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
exports.paymentTransactionsRelations = (0, drizzle_orm_1.relations)(exports.paymentTransactions, ({ one }) => ({
    order: one(order_1.orders, {
        fields: [exports.paymentTransactions.orderId],
        references: [order_1.orders.id],
    }),
    restaurant: one(restaurants_1.restaurants, {
        fields: [exports.paymentTransactions.restaurantId],
        references: [restaurants_1.restaurants.id],
    }),
    user: one(Users_1.users, {
        fields: [exports.paymentTransactions.userId],
        references: [Users_1.users.id],
    }),
}));
