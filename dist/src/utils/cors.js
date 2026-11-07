"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAllowedOrigin = isAllowedOrigin;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const domainCache_1 = require("./domainCache");
/**
 * Checks whether an incoming request Origin is allowed.
 * - Localhost / local IPs are always allowed for development.
 * - Requests without Origin are allowed (server-to-server, curl, mobile apps).
 * - Origins ending with .keeto.org (or keeto.org) are allowed.
 * - Custom domains are allowed if verified in restaurant_domains.
 */
async function isAllowedOrigin(origin) {
    if (!origin)
        return true;
    let hostname;
    try {
        hostname = new URL(origin).hostname.toLowerCase();
    }
    catch {
        return false;
    }
    // Local development
    if (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.endsWith(".localhost") ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("10.")) {
        return true;
    }
    // Any keeto.org domain or subdomain
    if (hostname === "keeto.org" || hostname.endsWith(".keeto.org")) {
        return true;
    }
    // Check in-memory cache
    const cached = domainCache_1.domainResolutionCache.get(hostname);
    if (cached !== undefined) {
        return cached !== null;
    }
    // Check database
    try {
        const rows = await connection_1.db
            .select({ id: schema_1.restaurantDomains.id })
            .from(schema_1.restaurantDomains)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.domain, hostname), (0, drizzle_orm_1.eq)(schema_1.restaurantDomains.verified, 1)))
            .limit(1);
        if (rows.length > 0) {
            return true;
        }
        else {
            domainCache_1.domainResolutionCache.setNegative(hostname);
            return false;
        }
    }
    catch (err) {
        console.error("[CORS] Database check failed for origin:", origin, err);
        return false;
    }
}
