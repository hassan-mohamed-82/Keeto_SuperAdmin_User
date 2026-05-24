import { mysqlTable, varchar, char, timestamp, decimal, mysqlEnum, text, int } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { food } from "./food";
import { users } from "../user/Users";
// تم مسح الـ import الخاص بـ paymentMethods
import { branches } from "../../schema";
import { addresses } from "../user/address";

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

    // 👇 ده الحقل اللي كان ناقص وعامل المشكلة
    branchId: char("branch_id", { length: 36 })
        .references(() => branches.id),

    // 👇 عنوان التوصيل المختار من اليوزر
    addressId: char("address_id", { length: 36 })
        .references(() => addresses.id),

    orderSource: mysqlEnum("order_source", ["online_order", "food_aggregator","mykeeto"]).notNull(),

    // onlineOrderType:mysqlEnum("online_order_type", ["app"]).default(),

    // 👇 التعديل هنا: شلنا الربط وخليناها Enum بتلات قيم بس
    paymentMethod: mysqlEnum("payment_method", ["cash_on_delivery", "visa", "wallet"]).notNull(),

    orderType: mysqlEnum("order_type", ["delivery", "takeaway", "dine_in"]).default("delivery"),

    subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
    deliveryFee: decimal("delivery_fee", { precision: 10, scale: 2 }).default("0.00"),
    serviceFee: decimal("service_fee", { precision: 10, scale: 2 }).default("0.00"),
    appCommission: decimal("app_commission", { precision: 10, scale: 2 }).default("0.00"),
    totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),

    // 👇 ضفنا حالة rejected هنا
    status: mysqlEnum("status", [
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
    cancelReason: text("cancel_reason"), 
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
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