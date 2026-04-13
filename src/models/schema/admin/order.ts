import { mysqlTable, varchar, char, timestamp, decimal, mysqlEnum, text, int } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { food } from "./food";
import { users } from "../user/Users";
import { paymentMethods } from "./payment_methodes";

export const orders = mysqlTable("orders", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    orderNumber: varchar("order_number", { length: 20 }).notNull().unique(),

    idempotencyKey: varchar("idempotency_key", { length: 100 }).unique(),

    userId: char("user_id", { length: 36 })
        .references(() => users.id)
        .notNull(),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id)
        .notNull(),

    orderSource: mysqlEnum("order_source", ["online_order", "food_aggregator"]).notNull(),

    // 🔥 بدل enum
    paymentMethodId: char("payment_method_id", { length: 36 })
        .references(() => paymentMethods.id)
        .notNull(),

    orderType: mysqlEnum("order_type", ["delivery", "takeaway", "dine_in"]).default("delivery"),

    subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),

    deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }).default("0.00"),

    serviceFee: decimal("service_fee", { precision: 10, scale: 2 }).default("0.00"),

    appCommission: decimal("app_commission", { precision: 10, scale: 2 }).default("0.00"),

    totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),

    status: mysqlEnum("status", [
        "pending",
        "accepted",
        "preparing",
        "out_for_delivery",
        "delivered",
        "cancelled"
    ]).default("pending"),

    createdAt: timestamp("created_at").defaultNow(),
});
// ==========================================
// 3. جدول أصناف الأوردر (Order Items)
// ==========================================
export const orderItems = mysqlTable("order_items", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    orderId: char("order_id", { length: 36 })
        .references(() => orders.id)
        .notNull(),

    foodId: char("food_id", { length: 36 })
        .references(() => food.id)
        .notNull(),

    quantity: int("quantity").notNull(),

    basePrice: decimal("base_price", { precision: 10, scale: 2 }).notNull(),

    variationsPrice: decimal("variations_price", { precision: 10, scale: 2 }).default("0.00"),

    totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
});