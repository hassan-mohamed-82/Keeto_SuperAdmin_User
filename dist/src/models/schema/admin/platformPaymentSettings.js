"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.platformPaymentSettings = void 0;
// models/schema/admin/platformPaymentSettings.ts
// Singleton table holding the SYSTEM-visa gateway fee parameters.
// Exactly one row is kept (seeded in migration). Never insert a second row.
const mysql_core_1 = require("drizzle-orm/mysql-core");
exports.platformPaymentSettings = (0, mysql_core_1.mysqlTable)("platform_payment_settings", {
    // Primary key fixed at 1 to enforce the singleton pattern
    id: (0, mysql_core_1.int)("id").primaryKey().autoincrement(),
    // SYSTEM-visa gateway fee components
    // visaCommission = (totalAmount * percentageValue/100) + fixedValue + tax
    percentageValue: (0, mysql_core_1.decimal)("percentage_value", { precision: 10, scale: 4 }).default("0.0000").notNull(),
    fixedValue: (0, mysql_core_1.decimal)("fixed_value", { precision: 10, scale: 2 }).default("0.00").notNull(),
    tax: (0, mysql_core_1.decimal)("tax", { precision: 10, scale: 2 }).default("0.00").notNull(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
    // UUID of the admin who last changed the settings (nullable for seed)
    updatedBy: (0, mysql_core_1.char)("updated_by", { length: 36 }),
});
