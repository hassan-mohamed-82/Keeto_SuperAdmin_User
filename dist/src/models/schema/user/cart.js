"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cartItems = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const Users_1 = require("./Users");
const food_1 = require("../admin/food");
const restaurants_1 = require("../admin/restaurants");
const branches_1 = require("../admin/branches");
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
    // 🔥 snapshot السعر وقت الإضافة
    unitPrice: (0, mysql_core_1.varchar)("unit_price", { length: 50 }).notNull(),
    // 🔥 السعر الإجمالي (unitPrice * quantity)
    totalPrice: (0, mysql_core_1.varchar)("total_price", { length: 50 }).notNull(),
    variations: (0, mysql_core_1.json)("variations"),
    addons: (0, mysql_core_1.json)("addons"),
    note: (0, mysql_core_1.varchar)("note", { length: 500 }),
    // ─── Channel Pricing Context ───────────────────────────────────────
    // Nullable: populated only when the item was added with branchId+serviceModule context.
    // Used by GET /cart to detect price drift and by checkout for final validation.
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 }).references(() => branches_1.branches.id),
    serviceModule: (0, mysql_core_1.mysqlEnum)("service_module", ["takeaway", "dine_in", "delivery"]),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
