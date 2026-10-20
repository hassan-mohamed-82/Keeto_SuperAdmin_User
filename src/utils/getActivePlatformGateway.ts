// src/utils/getActivePlatformGateway.ts
// Fetches and decrypts the currently active SYSTEM-level payment gateway
// from the platform_payment_gateways table (managed by Super Admin in the DB).
// This replaces the old .env-based approach (KASHIER_MID, KASHIER_API_KEY, etc.)
// and supports any gateway provider: KASHIER, PAYMOB, GEIDEA.

import { db } from "../models/connection";
import { platformPaymentGateways } from "../models/schema";
import { eq, or } from "drizzle-orm";
import { decryptSecret } from "./encryption";

export type PlatformGatewayProvider = "KASHIER" | "PAYMOB" | "GEIDEA";

export interface ActivePlatformGateway {
    id: string;
    provider: PlatformGatewayProvider;
    title: string;
    environment: "LIVE" | "TEST";
    credentials: Record<string, any>; // already decrypted
    logoUrl: string | null;
}

// ─────────────────────────────────────────────────────────
// Sensitive fields to decrypt when returning credentials
// ─────────────────────────────────────────────────────────
const SENSITIVE_FIELDS = ["apiKey", "secretKey", "hmac", "apiPassword"] as const;

function decryptCredentials(raw: Record<string, any>): Record<string, any> {
    const decrypted = { ...raw };
    for (const f of SENSITIVE_FIELDS) {
        if (decrypted[f] && typeof decrypted[f] === "string") {
            decrypted[f] = decryptSecret(decrypted[f]);
        }
    }
    return decrypted;
}

function parseCredentials(creds: any): Record<string, any> {
    if (typeof creds === "string") {
        try { return JSON.parse(creds); } catch { return {}; }
    }
    return creds && typeof creds === "object" ? creds : {};
}

function toGateway(row: typeof platformPaymentGateways.$inferSelect): ActivePlatformGateway {
    const rawCreds = parseCredentials(row.credentials);
    const decryptedCreds = decryptCredentials(rawCreds);
    return {
        id: row.id,
        provider: row.provider as PlatformGatewayProvider,
        title: row.title,
        environment: (row.environment ?? "LIVE") as "LIVE" | "TEST",
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
export async function getActivePlatformGateway(): Promise<ActivePlatformGateway | null> {
    // First: try the actively enabled gateway
    const [activeRow] = await db
        .select()
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.isActive, true))
        .limit(1);

    if (activeRow) return toGateway(activeRow);

    // Fallback: the default gateway (isDefault = true)
    const [defaultRow] = await db
        .select()
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.isDefault, true))
        .limit(1);

    if (defaultRow) return toGateway(defaultRow);

    return null;
}

/**
 * Returns the default platform gateway (isDefault = true), regardless of isActive.
 * Used by the visa-switch logic to know which platform gateway to activate when
 * switching from CUSTOM → SYSTEM.
 */
export async function getDefaultPlatformGateway(): Promise<ActivePlatformGateway | null> {
    const [row] = await db
        .select()
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.isDefault, true))
        .limit(1);

    if (!row) return null;
    return toGateway(row);
}
