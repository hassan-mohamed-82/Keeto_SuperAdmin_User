"use strict";
// models/schema/admin/platformPaymentGateways.ts
// Platform-level payment gateways managed by the Super Admin.
// These are the system gateways used by restaurants that have NOT configured
// their own custom gateway (paymentGatewayType = "SYSTEM").
// Keys are stored encrypted in the DB — NOT in .env — so they can be managed
// dynamically without a server restart.
Object.defineProperty(exports, "__esModule", { value: true });
exports.platformPaymentGateways = void 0;
const mysql_core_1 = require("drizzle-orm/mysql-core");
const drizzle_orm_1 = require("drizzle-orm");
// ==========================================
// Table definition
// ==========================================
exports.platformPaymentGateways = (0, mysql_core_1.mysqlTable)("platform_payment_gateways", {
    id: (0, mysql_core_1.char)("id", { length: 36 }).primaryKey().default((0, drizzle_orm_1.sql) `(UUID())`),
    // Human-readable label shown in Super Admin dashboard
    title: (0, mysql_core_1.varchar)("title", { length: 255 }).notNull(),
    provider: (0, mysql_core_1.mysqlEnum)("provider", ["PAYMOB", "KASHIER", "GEIDEA"]).notNull(),
    environment: (0, mysql_core_1.mysqlEnum)("environment", ["LIVE", "TEST"]).default("LIVE"),
    // AES-256-GCM encrypted credentials stored as JSON
    credentials: (0, mysql_core_1.json)("credentials").$type().notNull(),
    // Optional logo URL displayed on dashboard
    logoUrl: (0, mysql_core_1.varchar)("logo_url", { length: 500 }),
    // Only ONE gateway can be active at a time (enforced at application level)
    isActive: (0, mysql_core_1.boolean)("is_active").default(false),
    createdAt: (0, mysql_core_1.timestamp)("created_at").defaultNow(),
    updatedAt: (0, mysql_core_1.timestamp)("updated_at").defaultNow().onUpdateNow(),
});
