import {
    mysqlTable,
    timestamp,
    mysqlEnum,
    char,
    decimal,
    uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { food } from "./food";
import { branches, branchMenuItems } from "./branches";
import { variationOptions } from "./variation";

// 1. Re-export Branch Menu Items from branches schema
export { branchMenuItems };

// 2. Branch Variant Pricing (Branch-Specific Variant Overrides)
export const branchVariantPricing = mysqlTable(
    "branch_variant_pricing",
    {
        id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
        branchId: char("branch_id", { length: 36 })
            .references(() => branches.id)
            .notNull(),
        variantId: char("variant_id", { length: 36 })
            .references(() => variationOptions.id)
            .notNull(),
        price: decimal("price", { precision: 10, scale: 2 }).default("0.00"),
        // active = available in this branch, inactive = unavailable
        status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
        createdAt: timestamp("created_at").defaultNow(),
        updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
    },
    (table) => ({
        branchVariantIdx: uniqueIndex("unique_branch_variant").on(table.branchId, table.variantId),
    })
);

// 3. Product Channel Pricing (Takeaway / Dine-In / Delivery Pricing)
export const productChannelPricing = mysqlTable(
    "product_channel_pricing",
    {
        id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
        foodId: char("food_id", { length: 36 })
            .references(() => food.id)
            .notNull(),
        branchId: char("branch_id", { length: 36 })
            .references(() => branches.id), // Nullable for Global Channel Defaults
        serviceModule: mysqlEnum("service_module", ["takeaway", "dine_in", "delivery"]).notNull(),
        price: decimal("price", { precision: 10, scale: 2 }).notNull(),
        // active = available on this channel, inactive = unavailable
        status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
        createdAt: timestamp("created_at").defaultNow(),
        updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
    },
    (table) => ({
        foodBranchModuleIdx: uniqueIndex("unique_food_branch_module").on(
            table.foodId,
            table.branchId,
            table.serviceModule
        ),
    })
);

// 4. Variant Channel Pricing (Takeaway / Dine-In / Delivery Variant Pricing)
export const variantChannelPricing = mysqlTable(
    "variant_channel_pricing",
    {
        id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),
        variantId: char("variant_id", { length: 36 })
            .references(() => variationOptions.id)
            .notNull(),
        branchId: char("branch_id", { length: 36 })
            .references(() => branches.id), // Nullable for Global Channel Defaults
        serviceModule: mysqlEnum("service_module", ["takeaway", "dine_in", "delivery"]).notNull(),
        price: decimal("price", { precision: 10, scale: 2 }).notNull(),
        // active = available on this channel, inactive = unavailable
        status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
        createdAt: timestamp("created_at").defaultNow(),
        updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
    },
    (table) => ({
        variantBranchModuleIdx: uniqueIndex("unique_variant_branch_module").on(
            table.variantId,
            table.branchId,
            table.serviceModule
        ),
    })
);
