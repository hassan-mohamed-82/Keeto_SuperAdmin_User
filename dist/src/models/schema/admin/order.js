"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderItems = exports.orders = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const restaurants_1 = require("./restaurants");
const food_1 = require("./food");
const Users_1 = require("../user/Users");
const schema_1 = require("../../schema");
const address_1 = require("../user/address");
const selectReasons_1 = require("./selectReasons");
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
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 })
        .references(() => schema_1.branches.id),
    // .notNull(),
    addressId: (0, mysql_core_1.char)("address_id", { length: 36 })
        .references(() => address_1.addresses.id),
    orderSource: (0, mysql_core_1.mysqlEnum)("order_source", ["online_order", "food_aggregator", "my_keeto"]).notNull(),
    paymentMethod: (0, mysql_core_1.char)("payment_method", { length: 36 }),
    orderType: (0, mysql_core_1.mysqlEnum)("order_type", ["delivery", "takeaway", "dine_in"]).default("delivery"),
    subtotal: (0, mysql_core_1.decimal)("subtotal", { precision: 10, scale: 2 }).notNull(),
    deliveryFee: (0, mysql_core_1.decimal)("delivery_fee", { precision: 10, scale: 2 }).default("0.00"),
    serviceFee: (0, mysql_core_1.decimal)("service_fee", { precision: 10, scale: 2 }).default("0.00"),
    appCommission: (0, mysql_core_1.decimal)("app_commission", { precision: 10, scale: 2 }).default("0.00"),
    discountAmount: (0, mysql_core_1.decimal)("discount_amount", { precision: 10, scale: 2 }).default("0.00"),
    couponCode: (0, mysql_core_1.varchar)("coupon_code", { length: 50 }),
    totalAmount: (0, mysql_core_1.decimal)("total_amount", { precision: 10, scale: 2 }).notNull(),
    status: (0, mysql_core_1.mysqlEnum)("status", [
        "pending",
        "accepted",
        "preparing",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "refund"
    ]).default("pending"),
    isPointsRedeemed: (0, mysql_core_1.boolean)("is_points_redeemed").default(false),
    redeemCode: (0, mysql_core_1.varchar)("redeem_code", { length: 10 }),
    redeemCodeExpiresAt: (0, mysql_core_1.timestamp)("redeem_code_expires_at"),
    cancelReasonId: (0, mysql_core_1.char)("cancel_reason_id", { length: 36 })
        .references(() => selectReasons_1.selectReasons.id),
    cancelReason: (0, mysql_core_1.text)("cancel_reason"),
    note: (0, mysql_core_1.text)("note"),
    dailyOrderNumber: (0, mysql_core_1.int)("daily_order_number").default(1),
    rating: (0, mysql_core_1.int)("rating"),
    ratingComment: (0, mysql_core_1.text)("rating_comment"),
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
    variations: (0, mysql_core_1.json)("variations"),
    note: (0, mysql_core_1.text)("note"),
});
