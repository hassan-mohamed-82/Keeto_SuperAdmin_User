import {
    mysqlTable,
    char,
    decimal,
    mysqlEnum,
    timestamp,
    uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { food } from "./food";
import { branches } from "./branches";
import { variationOptions } from "./variation";

// ============================================================================
// 1. Food Pricing Overrides
// ============================================================================
export const foodPricingOverrides = mysqlTable(
    "food_pricing_overrides",
    {
        id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

        foodId: char("food_id", { length: 36 })
            .references(() => food.id)
            .notNull(),

        // NULL = applies to every branch
        branchId: char("branch_id", { length: 36 }).references(() => branches.id),

        // NULL = applies to every service module (takeaway/dine_in/delivery)
        serviceModule: mysqlEnum("service_module", ["takeaway", "dine_in", "delivery"]),

        price: decimal("price", { precision: 10, scale: 2 }).notNull(),

        // active = this override is in effect, inactive = ignored (falls through
        // to the next-most-specific override / base price)
        status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),

        createdAt: timestamp("created_at").defaultNow(),
        updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
    },
    (table) => ({
        uniqueOverride: uniqueIndex("unique_food_branch_module").on(
            table.foodId,
            table.branchId,
            table.serviceModule
        ),
    })
);

// ============================================================================
// 2. Variant (variation option) Pricing Overrides
// ============================================================================
export const variantPricingOverrides = mysqlTable(
    "variant_pricing_overrides",
    {
        id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

        variantId: char("variant_id", { length: 36 })
            .references(() => variationOptions.id)
            .notNull(),

        branchId: char("branch_id", { length: 36 }).references(() => branches.id),
        serviceModule: mysqlEnum("service_module", ["takeaway", "dine_in", "delivery"]),

        price: decimal("price", { precision: 10, scale: 2 }).notNull(),
        status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),

        createdAt: timestamp("created_at").defaultNow(),
        updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
    },
    (table) => ({
        uniqueOverride: uniqueIndex("unique_variant_branch_module").on(
            table.variantId,
            table.branchId,
            table.serviceModule
        ),
    })
);