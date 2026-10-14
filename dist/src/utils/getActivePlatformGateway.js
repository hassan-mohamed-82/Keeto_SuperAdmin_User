"use strict";
// src/utils/getActivePlatformGateway.ts
// Fetches and decrypts the currently active SYSTEM-level payment gateway
// from the platform_payment_gateways table (managed by Super Admin in the DB).
// This replaces the old .env-based approach (KASHIER_MID, KASHIER_API_KEY, etc.)
// and supports any gateway provider: KASHIER, PAYMOB, GEIDEA.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActivePlatformGateway = getActivePlatformGateway;
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
/**
 * Returns the active platform-level payment gateway (decrypted credentials)
 * that the SYSTEM flow will use for restaurants without a custom gateway.
 *
 * Returns null if no active gateway has been configured by the Super Admin yet.
 * In that case callers fall back to the .env variables for backwards-compatibility.
 */
async function getActivePlatformGateway() {
    const [row] = await connection_1.db
        .select()
        .from(schema_1.platformPaymentGateways)
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.isActive, true))
        .limit(1);
    if (!row)
        return null;
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
