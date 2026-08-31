"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.variantChannelPricing = exports.productChannelPricing = exports.branchVariantPricing = exports.branchMenuItems = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
const food_1 = require("./food");
const branches_1 = require("./branches");
Object.defineProperty(exports, "branchMenuItems", { enumerable: true, get: function () { return branches_1.branchMenuItems; } });
const variation_1 = require("./variation");
// 2. Branch Variant Pricing (Branch-Specific Variant Overrides)
exports.branchVariantPricing = (0, mysql_core_1.mysqlTable)("branch_variant_pricing", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 })
        .references(() => branches_1.branches.id)
        .notNull(),
    variantId: (0, mysql_core_1.char)("variant_id", { length: 36 })
        .references(() => variation_1.variationOptions.id)
        .notNull(),
    price: (0, mysql_core_1.decimal)("price", { precision: 10, scale: 2 }).default("0.00"),
    // active = available in this branch, inactive = unavailable
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
}, (table) => ({
    branchVariantIdx: (0, mysql_core_1.uniqueIndex)("unique_branch_variant").on(table.branchId, table.variantId),
}));
// 3. Product Channel Pricing (Takeaway / Dine-In / Delivery Pricing)
exports.productChannelPricing = (0, mysql_core_1.mysqlTable)("product_channel_pricing", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    foodId: (0, mysql_core_1.char)("food_id", { length: 36 })
        .references(() => food_1.food.id)
        .notNull(),
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 })
        .references(() => branches_1.branches.id), // Nullable for Global Channel Defaults
    serviceModule: (0, mysql_core_1.mysqlEnum)("service_module", ["takeaway", "dine_in", "delivery"]).notNull(),
    price: (0, mysql_core_1.decimal)("price", { precision: 10, scale: 2 }).notNull(),
    // active = available on this channel, inactive = unavailable
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
}, (table) => ({
    foodBranchModuleIdx: (0, mysql_core_1.uniqueIndex)("unique_food_branch_module").on(table.foodId, table.branchId, table.serviceModule),
}));
// 4. Variant Channel Pricing (Takeaway / Dine-In / Delivery Variant Pricing)
exports.variantChannelPricing = (0, mysql_core_1.mysqlTable)("variant_channel_pricing", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    variantId: (0, mysql_core_1.char)("variant_id", { length: 36 })
        .references(() => variation_1.variationOptions.id)
        .notNull(),
    branchId: (0, mysql_core_1.char)("branch_id", { length: 36 })
        .references(() => branches_1.branches.id), // Nullable for Global Channel Defaults
    serviceModule: (0, mysql_core_1.mysqlEnum)("service_module", ["takeaway", "dine_in", "delivery"]).notNull(),
    price: (0, mysql_core_1.decimal)("price", { precision: 10, scale: 2 }).notNull(),
    // active = available on this channel, inactive = unavailable
    status: (0, mysql_core_1.mysqlEnum)("status", ["active", "inactive"]).default("active").notNull(),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
}, (table) => ({
    variantBranchModuleIdx: (0, mysql_core_1.uniqueIndex)("unique_variant_branch_module").on(table.variantId, table.branchId, table.serviceModule),
}));
