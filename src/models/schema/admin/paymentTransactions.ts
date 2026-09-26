import {
    mysqlTable,
    varchar,
    char,
    decimal,
    timestamp,
    mysqlEnum,
    text,
    json
} from "drizzle-orm/mysql-core";
import { sql, relations } from "drizzle-orm";
import { orders } from "./order";
import { restaurants } from "./restaurants";
import { users } from "../user/Users";

// ==========================================
// جدول سجل معاملات بوابات الدفع (Payment Transactions)
// ==========================================
export const paymentTransactions = mysqlTable("payment_transactions", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    orderId: char("order_id", { length: 36 })
        .references(() => orders.id, { onDelete: "set null" }),

    orderNumber: varchar("order_number", { length: 50 }),

    userId: char("user_id", { length: 36 })
        .references(() => users.id, { onDelete: "set null" }),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "set null" }),

    gateway: mysqlEnum("gateway", ["kashier", "paymob"]).notNull(),

    // المعرف الخاص بالمعاملة من البوابة (مثل transaction id)
    transactionId: varchar("transaction_id", { length: 150 }),

    // المعرف الخاص بالأوردر لدى البوابة (مثل paymob order_id أو kashier orderId / sessionId)
    gatewayOrderId: varchar("gateway_order_id", { length: 150 }),

    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),

    currency: varchar("currency", { length: 10 }).default("EGP"),

    status: mysqlEnum("status", ["pending", "success", "failed"]).default("pending").notNull(),

    // سبب الفشل أو رسالة الخطأ القادمة من البوابة
    failureReason: text("failure_reason"),

    // الـ Payload / Webhook Data بالكامل للرجوع إليه وتتبعه
    rawResponse: json("raw_response"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const paymentTransactionsRelations = relations(paymentTransactions, ({ one }) => ({
    order: one(orders, {
        fields: [paymentTransactions.orderId],
        references: [orders.id],
    }),
    restaurant: one(restaurants, {
        fields: [paymentTransactions.restaurantId],
        references: [restaurants.id],
    }),
    user: one(users, {
        fields: [paymentTransactions.userId],
        references: [users.id],
    }),
}));
