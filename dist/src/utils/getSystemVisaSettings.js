"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSystemVisaSettings = getSystemVisaSettings;
exports.invalidateSystemVisaSettingsCache = invalidateSystemVisaSettingsCache;
/**
 * getSystemVisaSettings.ts
 *
 * Fetches (and caches briefly) the platform-level SYSTEM-visa gateway fee
 * parameters from the platform_payment_settings singleton row.
 *
 * Cache TTL: 60 seconds — short enough to pick up admin changes quickly,
 * long enough to avoid hitting the DB on every order.
 */
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
let _cache = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 60000; // 60 seconds
/**
 * Returns the SYSTEM-visa fee settings from DB (with a short in-memory cache).
 * Falls back to {0, 0, 0} if the table has no row yet.
 */
async function getSystemVisaSettings() {
    const now = Date.now();
    if (_cache && now < _cacheExpiry) {
        return _cache;
    }
    const [row] = await connection_1.db
        .select({
        percentageValue: schema_1.platformPaymentSettings.percentageValue,
        fixedValue: schema_1.platformPaymentSettings.fixedValue,
        tax: schema_1.platformPaymentSettings.tax,
    })
        .from(schema_1.platformPaymentSettings)
        .limit(1);
    const result = {
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
function invalidateSystemVisaSettingsCache() {
    _cache = null;
    _cacheExpiry = 0;
}
