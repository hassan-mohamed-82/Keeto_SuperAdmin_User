/**
 * getSystemVisaSettings.ts
 *
 * Fetches (and caches briefly) the platform-level SYSTEM-visa gateway fee
 * parameters from the platform_payment_settings singleton row.
 *
 * Cache TTL: 60 seconds — short enough to pick up admin changes quickly,
 * long enough to avoid hitting the DB on every order.
 */
import { db } from "../models/connection";
import { platformPaymentSettings } from "../models/schema";

interface SystemVisaSettings {
    percentageValue: number; // e.g. 2 means 2%
    fixedValue: number;      // flat EGP amount per transaction
    tax: number;             // flat tax EGP amount per transaction
}

let _cache: SystemVisaSettings | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Returns the SYSTEM-visa fee settings from DB (with a short in-memory cache).
 * Falls back to {0, 0, 0} if the table has no row yet.
 */
export async function getSystemVisaSettings(): Promise<SystemVisaSettings> {
    const now = Date.now();
    if (_cache && now < _cacheExpiry) {
        return _cache;
    }

    const [row] = await db
        .select({
            percentageValue: platformPaymentSettings.percentageValue,
            fixedValue: platformPaymentSettings.fixedValue,
            tax: platformPaymentSettings.tax,
        })
        .from(platformPaymentSettings)
        .limit(1);

    const result: SystemVisaSettings = {
        percentageValue: parseFloat(String(row?.percentageValue ?? "0")),
        fixedValue: parseFloat(String(row?.fixedValue ?? "0")),
        tax: parseFloat(String(row?.tax ?? "0")),
    };

    _cache = result;
    _cacheExpiry = now + CACHE_TTL_MS;

    return result;
}

/**
 * Invalidates the in-memory cache so the next call reads fresh data from DB.
 * Call this after an admin updates the settings.
 */
export function invalidateSystemVisaSettingsCache(): void {
    _cache = null;
    _cacheExpiry = 0;
}
