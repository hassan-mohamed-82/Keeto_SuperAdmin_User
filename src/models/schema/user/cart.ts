import { mysqlTable, varchar, char, timestamp, decimal, json, boolean, int, mysqlEnum } from "drizzle-orm/mysql-core";
import { sql, relations } from "drizzle-orm";
import { users } from "./Users";
import { food } from "../admin/food";
import { restaurants } from "../admin/restaurants";
import { branches } from "../admin/branches";
import { offers } from "../admin/offers";
import { weightRequests } from "../admin/weightRequests";

export const cartItems = mysqlTable("cart_items", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    userId: char("user_id", { length: 36 })
        .references(() => users.id)
        .notNull(),

    restaurantId: char("restaurant_id", { length: 36 })
        .references(() => restaurants.id)
        .notNull(),

    foodId: char("food_id", { length: 36 })
        .references(() => food.id)
        .notNull(),

    quantity: int("quantity").notNull().default(1),

    // Weight chosen by the customer (in the food's weight_unit). NULL for unit-sold foods.
    weight: decimal("weight", { precision: 10, scale: 3 }),

    // ── Weight-request locking & weighing columns ─────────────────────────
    // Set by the restaurant during the weighing phase. Cleared on cancel/expire.

    /** Actual weight confirmed by the restaurant. NULL until weighing completes. */
    finalWeight: decimal("final_weight", { precision: 10, scale: 3 }),

    /** True if the restaurant marks this item as unavailable during weighing. */
    isUnavailable: boolean("is_unavailable").default(false),

    /** Snapshot of food.weight_unit at request time. NULL for unit-sold foods. */
    weightUnit: mysqlEnum("weight_unit", ["kg", "gm"]),

    /** FK to weight_requests that locked this cart item. NULL = unlocked. */
    weightRequestId: char("weight_request_id", { length: 36 })
        .references(() => weightRequests.id, { onDelete: "set null" }),

    // 🔥 snapshot السعر وقت الإضافة
    unitPrice: varchar("unit_price", { length: 50 }).notNull(),

    // 🔥 السعر الإجمالي (unitPrice * quantity, or round(weight * unitPrice, 2) for weighted)
    totalPrice: varchar("total_price", { length: 50 }).notNull(),

    variations: json("variations"),

    addons: json("addons"),

    note: varchar("note", { length: 500 }),

    // ─── Channel Pricing Context ───────────────────────────────────────
    // Nullable: populated only when the item was added with branchId+serviceModule context.
    branchId: char("branch_id", { length: 36 }).references(() => branches.id),
    serviceModule: mysqlEnum("service_module", ["takeaway", "dine_in", "delivery"]),

    // ─── Bundle Offer Reference ────────────────────────────────────────
    offerId: char("offer_id", { length: 36 }).references(() => offers.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
    user: one(users, {
        fields: [cartItems.userId],
        references: [users.id],
    }),
    restaurant: one(restaurants, {
        fields: [cartItems.restaurantId],
        references: [restaurants.id],
    }),
    food: one(food, {
        fields: [cartItems.foodId],
        references: [food.id],
    }),
    weightRequest: one(weightRequests, {
        fields: [cartItems.weightRequestId],
        references: [weightRequests.id],
    }),
}));