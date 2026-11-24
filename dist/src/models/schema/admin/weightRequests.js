"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weightRequestsRelations = exports.weightRequests = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const Users_1 = require("../user/Users");
const restaurants_1 = require("./restaurants");
const branches_1 = require("./branches");
const order_1 = require("./order");
exports.weightRequests = (0, mysql_core_1.mysqlTable)("weight_requests", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id, { onDelete: "cascade" })
        .notNull(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id, { onDelete: "cascade" })
        .notNull(),
    /** Branch the cart is associated with (resolved at request time). */
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 })
        .references(() => branches_1.branches.id, { onDelete: "set null" }),
    /**
     * awaiting_weighing       – waiting for restaurant staff to enter weights
     * awaiting_customer_approval – weights submitted; waiting for customer
     * checking_out            – Visa checkout claimed; payment session / order in progress (cart frozen)
     * approved                – customer approved; order_id is set
     * cancelled               – customer cancelled (from awaiting_customer_approval)
     * expired                 – auto-cancelled by cron (restaurant or customer timeout)
     */
    status: (0, mysql_core_1.mysqlEnum)("status", [
        "awaiting_weighing",
        "awaiting_customer_approval",
        "checking_out",
        "approved",
        "cancelled",
        "expired",
    ]).notNull().default("awaiting_weighing"),
    /** Human-readable reason set on cancellation or expiry. */
    cancelReason: (0, mysql_core_1.varchar)("cancel_reason", { length: 255 }),
    /** Deadline for the current status step. Used by the expiry cron. */
    expiresAt: (0, mysql_core_1.timestamp)("expires_at").notNull(),
    /**
     * Set to the created order id when status = 'approved'.
     * NULL at all other times.
     */
    orderId: (0, mysql_core_1.char)("order_id", { length: 36 })
        .references(() => order_1.orders.id, { onDelete: "set null" }),
    /** Restaurant staff user id who performed the weighing. */
    weighedBy: (0, mysql_core_1.char)("weighed_by", { length: 36 }),
    /** Timestamp when restaurant staff submitted the weights. */
    weighedAt: (0, mysql_core_1.timestamp)("weighed_at"),
    /**
     * Audit log of all items weighed / updated in this request.
     * Written in the same transaction as the weighing.
     */
    weighingLog: (0, mysql_core_1.json)("weighing_log").$type(),
    /** Failed / abandoned Visa payment attempts for this request (expires at 3). */
    paymentAttempts: (0, mysql_core_1.int)("payment_attempts").notNull().default(0),
    /** When the current Visa checkout claim (status checking_out) started. */
    checkoutStartedAt: (0, mysql_core_1.timestamp)("checkout_started_at"),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow().notNull(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
    // Cron uses this to find expired requests efficiently.
    statusExpiresIdx: (0, mysql_core_1.index)("idx_wr_status_expires").on(table.status, table.expiresAt),
    // Enforce only one active request per user+restaurant (enforced in app layer too).
    userRestaurantIdx: (0, mysql_core_1.index)("idx_wr_user_restaurant").on(table.userId, table.restaurantId),
    // Payment confirmation / cron look requests up by order.
    orderIdx: (0, mysql_core_1.index)("idx_wr_order_id").on(table.orderId),
}));
exports.weightRequestsRelations = (0, drizzle_orm_1.relations)(exports.weightRequests, ({ one }) => ({
    user: one(Users_1.users, {
        fields: [exports.weightRequests.userId],
        references: [Users_1.users.id],
    }),
    restaurant: one(restaurants_1.restaurants, {
        fields: [exports.weightRequests.restaurantId],
        references: [restaurants_1.restaurants.id],
    }),
    branch: one(branches_1.branches, {
        fields: [exports.weightRequests.branchId],
        references: [branches_1.branches.id],
    }),
    order: one(order_1.orders, {
        fields: [exports.weightRequests.orderId],
        references: [order_1.orders.id],
    }),
}));
