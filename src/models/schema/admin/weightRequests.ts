import {
    mysqlTable,
    char,
    mysqlEnum,
    varchar,
    timestamp,
    json,
    index,
} from "drizzle-orm/mysql-core";
import { sql, relations } from "drizzle-orm";
import { users } from "../user/Users";
import { restaurants } from "./restaurants";
import { branches } from "./branches";
import { orders } from "./order";

// ==========================================
// Weight Requests Table
// ==========================================
// Represents a "send cart for weighing" session. Created when a customer submits
// a cart containing at least one weight-based food item. The corresponding cart
// items are locked (via cart_items.weight_request_id) for the duration.
//
// An order is NOT created until the customer approves after weighing.
// ==========================================

export interface WeighingLogEntry {
    foodId: string;
    foodName: string;
    oldWeight: number | string | null;
    newWeight: number | string | null;
    oldTotal: number | string;
    newTotal: number | string;
    unavailable?: boolean;
    reason?: string | null;
}

export const weightRequests = mysqlTable("weight_requests", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    userId: char("user_id", { length: 36 })
        .references(() => users.id, { onDelete: "cascade" })
        .notNull(),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id, { onDelete: "cascade" })
        .notNull(),

    /** Branch the cart is associated with (resolved at request time). */
    branchId: char("branch_id", { length: 36 })
        .references(() => branches.id, { onDelete: "set null" }),

    /**
     * awaiting_weighing       – waiting for restaurant staff to enter weights
     * awaiting_customer_approval – weights submitted; waiting for customer
     * approved                – customer approved; order_id is set
     * cancelled               – customer cancelled (from awaiting_customer_approval)
     * expired                 – auto-cancelled by cron (restaurant or customer timeout)
     */
    status: mysqlEnum("status", [
        "awaiting_weighing",
        "awaiting_customer_approval",
        "approved",
        "cancelled",
        "expired",
    ]).notNull().default("awaiting_weighing"),

    /** Human-readable reason set on cancellation or expiry. */
    cancelReason: varchar("cancel_reason", { length: 255 }),

    /** Deadline for the current status step. Used by the expiry cron. */
    expiresAt: timestamp("expires_at").notNull(),

    /**
     * Set to the created order id when status = 'approved'.
     * NULL at all other times.
     */
    orderId: char("order_id", { length: 36 })
        .references(() => orders.id, { onDelete: "set null" }),

    /** Restaurant staff user id who performed the weighing. */
    weighedBy: char("weighed_by", { length: 36 }),

    /** Timestamp when restaurant staff submitted the weights. */
    weighedAt: timestamp("weighed_at"),

    /**
     * Audit log of all items weighed / updated in this request.
     * Written in the same transaction as the weighing.
     */
    weighingLog: json("weighing_log").$type<WeighingLogEntry[]>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
    // Cron uses this to find expired requests efficiently.
    statusExpiresIdx: index("idx_wr_status_expires").on(table.status, table.expiresAt),
    // Enforce only one active request per user+restaurant (enforced in app layer too).
    userRestaurantIdx: index("idx_wr_user_restaurant").on(table.userId, table.restaurantId),
}));

export const weightRequestsRelations = relations(weightRequests, ({ one }) => ({
    user: one(users, {
        fields: [weightRequests.userId],
        references: [users.id],
    }),
    restaurant: one(restaurants, {
        fields: [weightRequests.restaurantId],
        references: [restaurants.id],
    }),
    branch: one(branches, {
        fields: [weightRequests.branchId],
        references: [branches.id],
    }),
    order: one(orders, {
        fields: [weightRequests.orderId],
        references: [orders.id],
    }),
}));
