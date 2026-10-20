// models/schema/admin/platformPaymentGateways.ts
// Platform-level payment gateways managed by the Super Admin.
// These are the system gateways used by restaurants that have NOT configured
// their own custom gateway (paymentGatewayType = "SYSTEM").
// Keys are stored encrypted in the DB — NOT in .env — so they can be managed
// dynamically without a server restart.

import {
    mysqlTable,
    varchar,
    char,
    boolean,
    timestamp,
    mysqlEnum,
    json,
    text,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ==========================================
// Credential interfaces per provider
// ==========================================

export interface PlatformKashierCredentials {
    mid: string;
    apiKey: string;
    secretKey?: string;
    baseUrl?: string;
}

export interface PlatformPaymobCredentials {
    secretKey: string;
    publicKey: string;
    integrationId: string;
    hmac: string;
    callbackUrl?: string;
    apiKey?: string;
    iframeId?: string;
}

export interface PlatformGeideaCredentials {
    publicKey: string;
    apiPassword: string;
    name?: string;
    environment?: string;
    callbackUrl?: string;
    returnUrl?: string;
}

export type PlatformGatewayCredentials =
    | PlatformKashierCredentials
    | PlatformPaymobCredentials
    | PlatformGeideaCredentials
    | Record<string, any>;

// ==========================================
// Table definition
// ==========================================

export const platformPaymentGateways = mysqlTable("platform_payment_gateways", {
    id: char("id", { length: 36 }).primaryKey().default(sql`(UUID())`),

    // Human-readable label shown in Super Admin dashboard
    title: varchar("title", { length: 255 }).notNull(),

    provider: mysqlEnum("provider", ["PAYMOB", "KASHIER", "GEIDEA"]).notNull(),

    environment: mysqlEnum("environment", ["LIVE", "TEST"]).default("LIVE"),

    // AES-256-GCM encrypted credentials stored as JSON
    credentials: json("credentials").$type<PlatformGatewayCredentials>().notNull(),

    // Optional logo image stored as a base64 data URI (e.g. "data:image/png;base64,...")
    logoUrl: text("logo_url"),

    // Only ONE gateway can be active at a time (enforced at application level)
    isActive: boolean("is_active").default(false),
    isDefault: boolean("is_default").default(false),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow(),
});
