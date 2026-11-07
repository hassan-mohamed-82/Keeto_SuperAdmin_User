"use strict";
// src/utils/getActivePlatformGateway.ts
// Fetches and decrypts the currently active SYSTEM-level payment gateway
// from the platform_payment_gateways table (managed by Super Admin in the DB).
// This replaces the old .env-based approach (KASHIER_MID, KASHIER_API_KEY, etc.)
// and supports any gateway provider: KASHIER, PAYMOB, GEIDEA.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActivePlatformGateway = getActivePlatformGateway;
exports.getDefaultPlatformGateway = getDefaultPlatformGateway;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const encryption_1 = require("./encryption");
// ─────────────────────────────────────────────────────────
// Sensitive fields to decrypt when returning credentials
// ─────────────────────────────────────────────────────────
const SENSITIVE_FIELDS = ["apiKey", "secretKey", "hmac", "apiPassword"];
function decryptCredentials(raw) {
    const decrypted = { ...raw };
    for (const f of SENSITIVE_FIELDS) {
        if (decrypted[f] && typeof decrypted[f] === "string") {
            decrypted[f] = (0, encryption_1.decryptSecret)(decrypted[f]);
        }
    }
    return decrypted;
}
function parseCredentials(creds) {
    if (typeof creds === "string") {
        try {
            return JSON.parse(creds);
        }
        catch {
            return {};
        }
    }
    return creds && typeof creds === "object" ? creds : {};
}
function toGateway(row) {
    const rawCreds = parseCredentials(row.credentials);
    const decryptedCreds = decryptCredentials(rawCreds);
    return {
        id: row.id,
        provider: row.provider,
        title: row.title,
        environment: (row.environment ?? "LIVE"),
        credentials: decryptedCreds,
        logoUrl: row.logoUrl ?? null,
    };
}
/**
 * Returns the active platform-level payment gateway (decrypted credentials)
 * that the SYSTEM flow will use for restaurants without a custom gateway.
 *
 * Priority:
 *  1. The gateway marked as isActive = true
 *  2. Fallback: the gateway marked as isDefault = true (useful after visa-switch
 *     when the system needs to resume using the platform gateway)
 *
 * Returns null if no active/default gateway has been configured.
 * In that case callers fall back to the .env variables for backwards-compatibility.
 */
async function getActivePlatformGateway() {
    // First: try the actively enabled gateway
    const [activeRow] = await connection_1.db
        .select()
        .from(schema_1.platformPaymentGateways)
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.isActive, true))
        .limit(1);
    if (activeRow)
        return toGateway(activeRow);
    // Fallback: the default gateway (isDefault = true)
    const [defaultRow] = await connection_1.db
        .select()
        .from(schema_1.platformPaymentGateways)
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.isDefault, true))
        .limit(1);
    if (defaultRow)
        return toGateway(defaultRow);
    return null;
}
/**
 * Returns the default platform gateway (isDefault = true), regardless of isActive.
 * Used by the visa-switch logic to know which platform gateway to activate when
 * switching from CUSTOM → SYSTEM.
 */
async function getDefaultPlatformGateway() {
    const [row] = await connection_1.db
        .select()
        .from(schema_1.platformPaymentGateways)
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.isDefault, true))
        .limit(1);
    if (!row)
        return null;
    return toGateway(row);
}
