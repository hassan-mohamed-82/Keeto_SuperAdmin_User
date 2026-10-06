// models/schema/admin/platformPaymentSettings.ts
// Singleton table holding the SYSTEM-visa gateway fee parameters.
// Exactly one row is kept (seeded in migration). Never insert a second row.
import {
    mysqlTable,
    int,
    decimal,
    char,
    timestamp,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const platformPaymentSettings = mysqlTable("platform_payment_settings", {
    // Primary key fixed at 1 to enforce the singleton pattern
    id: int("id").primaryKey().autoincrement(),

    // SYSTEM-visa gateway fee components
    // visaCommission = (totalAmount * percentageValue/100) + fixedValue + tax
    percentageValue: decimal("percentage_value", { precision: 10, scale: 4 }).default("0.0000").notNull(),
    fixedValue: decimal("fixed_value", { precision: 10, scale: 2 }).default("0.00").notNull(),
    tax: decimal("tax", { precision: 10, scale: 2 }).default("0.00").notNull(),

    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
    // UUID of the admin who last changed the settings (nullable for seed)
    updatedBy: char("updated_by", { length: 36 }),
});
