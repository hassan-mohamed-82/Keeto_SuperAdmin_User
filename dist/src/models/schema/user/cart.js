"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cartItemsRelations = exports.cartItems = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const Users_1 = require("./Users");
const food_1 = require("../admin/food");
const restaurants_1 = require("../admin/restaurants");
const branches_1 = require("../admin/branches");
const offers_1 = require("../admin/offers");
const weightRequests_1 = require("../admin/weightRequests");
exports.cartItems = (0, mysql_core_1.mysqlTable)("cart_items", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    userId: (0, mysql_core_1.char)("user_id", { length: 36 })
        .references(() => Users_1.users.id)
        .notNull(),
    restaurantId: (0, mysql_core_1.char)("restaurant_id", { length: 36 })
        .references(() => restaurants_1.restaurants.id)
        .notNull(),
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 })
        .references(() => food_1.food.id)
        .notNull(),
    quantity: (0, mysql_core_1.int)("quantity").notNull().default(1),
    // Weight chosen by the customer (in the food's weight_unit). NULL for unit-sold foods.
    weight: (0, mysql_core_1.decimal)("weight", { precision: 10, scale: 3 }),
    // ── Weight-request locking & weighing columns ─────────────────────────
    // Set by the restaurant during the weighing phase. Cleared on cancel/expire.
    /** Actual weight confirmed by the restaurant. NULL until weighing completes. */
    finalWeight: (0, mysql_core_1.decimal)("final_weight", { precision: 10, scale: 3 }),
    /** True if the restaurant marks this item as unavailable during weighing. */
    isUnavailable: (0, mysql_core_1.boolean)("is_unavailable").default(false),
    /** Snapshot of food.weight_unit at request time. NULL for unit-sold foods. */
    weightUnit: (0, mysql_core_1.mysqlEnum)("weight_unit", ["kg", "gm"]),
    /** FK to weight_requests that locked this cart item. NULL = unlocked. */
    weightRequestId: (0, mysql_core_1.char)("weight_request_id", { length: 36 })
        .references(() => weightRequests_1.weightRequests.id, { onDelete: "set null" }),
    /** Who added this line item: customer or restaurant staff during weighing */
    addedBy: (0, mysql_core_1.mysqlEnum)("added_by", ["customer", "restaurant"]).notNull().default("customer"),
    /** Staff admin user ID if added by restaurant */
    addedByAdminId: (0, mysql_core_1.char)("added_by_admin_id", { length: 36 }),
    // 🔥 snapshot السعر وقت الإضافة
    unitPrice: (0, mysql_core_1.varchar)("unit_price", { length: 50 }).notNull(),
    // 🔥 السعر الإجمالي (unitPrice * quantity, or round(weight * unitPrice, 2) for weighted)
    totalPrice: (0, mysql_core_1.varchar)("total_price", { length: 50 }).notNull(),
    variations: (0, mysql_core_1.json)("variations"),
    addons: (0, mysql_core_1.json)("addons"),
    note: (0, mysql_core_1.varchar)("note", { length: 500 }),
    // ─── Channel Pricing Context ───────────────────────────────────────
    // Nullable: populated only when the item was added with branchId+serviceModule context.
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 }).references(() => branches_1.branches.id),
    serviceModule: (0, mysql_core_1.mysqlEnum)("service_module", ["takeaway", "dine_in", "delivery"]),
    // ─── Bundle Offer Reference ────────────────────────────────────────
    offerId: (0, mysql_core_1.char)("offer_id", { length: 36 }).references(() => offers_1.offers.id, { onDelete: "set null" }),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
exports.cartItemsRelations = (0, drizzle_orm_1.relations)(exports.cartItems, ({ one }) => ({
    user: one(Users_1.users, {
        fields: [exports.cartItems.userId],
        references: [Users_1.users.id],
    }),
    restaurant: one(restaurants_1.restaurants, {
        fields: [exports.cartItems.restaurantId],
        references: [restaurants_1.restaurants.id],
    }),
    food: one(food_1.food, {
        fields: [exports.cartItems.foodId],
        references: [food_1.food.id],
    }),
    weightRequest: one(weightRequests_1.weightRequests, {
        fields: [exports.cartItems.weightRequestId],
        references: [weightRequests_1.weightRequests.id],
    }),
}));
