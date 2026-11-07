"use strict";
/**
 * Subdomain availability checking for single-label subdomains under ROOT_ZONE.
 *
 * Check sequence (stops at first failure):
 *  a) Format: lowercase, 3-30 chars, [a-z0-9-], no leading/trailing '-', no '--' -> 'invalid'
 *  b) Reserved list: matches RESERVED_SUBDOMAINS -> 'reserved'
 *  c) Database row: domain = label.ROOT_ZONE -> 'taken'
 *  d) Plesk: exists on server as site, subdomain, or alias -> 'exists_on_server'.
 *     If Plesk is unreachable -> 'check_unavailable' (never pass silently!)
 *  e) DNS: only if CHECK_DNS_FOR_SUBDOMAIN=true. Detects wildcard first.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidatePleskDomainsCache = invalidatePleskDomainsCache;
exports.isValidSubdomainLabel = isValidSubdomainLabel;
exports.isSubdomainAvailable = isSubdomainAvailable;
const crypto_1 = __importDefault(require("crypto"));
const dns_1 = __importDefault(require("dns"));
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const pleskClient_1 = require("./pleskClient");
const DEFAULT_RESERVED = [
    "www",
    "api",
    "admin",
    "super",
    "login",
    "mail",
    "webmail",
    "ftp",
    "smtp",
    "imap",
    "pop",
    "ns1",
    "ns2",
    "orderfood",
    "app",
    "static",
    "cdn",
    "test",
    "autodiscover",
    "keetobcknd",
    "restbcknd",
    "salesbcknd",
];
function getRootZone() {
    return (process.env.ROOT_ZONE || "keeto.org").trim().toLowerCase();
}
function getReservedSubdomains() {
    const envList = (process.env.RESERVED_SUBDOMAINS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    const merged = new Set([...DEFAULT_RESERVED, ...envList]);
    return merged;
}
let pleskCache = null;
const PLESK_CACHE_TTL_MS = 60000;
async function getPleskDomains() {
    const now = Date.now();
    if (pleskCache && now - pleskCache.fetchedAt < PLESK_CACHE_TTL_MS) {
        return pleskCache.domains;
    }
    const domains = new Set();
    // Fetch domains / sites / subdomains from Plesk
    const domResult = await (0, pleskClient_1.pleskCli)("domain", ["--list"]);
    if (domResult.code !== 0) {
        throw new Error(`Plesk domain --list returned error code ${domResult.code}: ${domResult.stderr}`);
    }
    for (const line of domResult.stdout.split(/\r?\n/)) {
        const d = line.trim().toLowerCase();
        if (d)
            domains.add(d);
    }
    // Also fetch aliases if supported
    try {
        const aliasResult = await (0, pleskClient_1.pleskCli)("domalias", ["--list"]);
        if (aliasResult.code === 0) {
            for (const line of aliasResult.stdout.split(/\r?\n/)) {
                const a = line.trim().toLowerCase();
                if (a)
                    domains.add(a);
            }
        }
    }
    catch {
        // domalias --list might not have items or command name differs; non-fatal
    }
    pleskCache = {
        domains,
        fetchedAt: now,
    };
    return domains;
}
/** Invalidate the Plesk domain cache (e.g. after adding a domain) */
function invalidatePleskDomainsCache() {
    pleskCache = null;
}
// ─── Subdomain Label Validator ──────────────────────────────────────────────
function isValidSubdomainLabel(label) {
    if (!label || typeof label !== "string")
        return false;
    if (label.length < 3 || label.length > 30)
        return false;
    // lowercase alphanumeric and hyphens
    if (!/^[a-z0-9-]+$/.test(label))
        return false;
    // no leading or trailing hyphens
    if (label.startsWith("-") || label.endsWith("-"))
        return false;
    // no consecutive hyphens
    if (label.includes("--"))
        return false;
    return true;
}
// ─── Wildcard DNS Check Helper ──────────────────────────────────────────────
async function hasWildcardDns(rootZone) {
    const randomLabel = `wld-${crypto_1.default.randomBytes(8).toString("hex")}.${rootZone}`;
    try {
        const [aRecords, cnameRecords] = await Promise.all([
            dns_1.default.promises.resolve4(randomLabel).catch(() => []),
            dns_1.default.promises.resolveCname(randomLabel).catch(() => []),
        ]);
        return aRecords.length > 0 || cnameRecords.length > 0;
    }
    catch {
        return false;
    }
}
// ─── Main Availability Check ────────────────────────────────────────────────
/**
 * Check whether a subdomain label is available under ROOT_ZONE.
 * Stops at first failure in required order.
 */
async function isSubdomainAvailable(rawLabel) {
    const label = (rawLabel || "").trim().toLowerCase();
    const rootZone = getRootZone();
    const targetDomain = `${label}.${rootZone}`;
    // a) Format check
    if (!isValidSubdomainLabel(label)) {
        return {
            label,
            domain: targetDomain,
            available: false,
            reason: "invalid",
            message: "Subdomain label must be 3-30 lowercase alphanumeric characters and single hyphens, cannot start or end with a hyphen, and cannot contain consecutive hyphens.",
        };
    }
    // b) Reserved list check
    const reserved = getReservedSubdomains();
    if (reserved.has(label)) {
        return {
            label,
            domain: targetDomain,
            available: false,
            reason: "reserved",
            message: `The subdomain '${label}' is reserved for platform services.`,
        };
    }
    // c) Database check: does targetDomain exist in restaurant_domains?
    try {
        const existing = await connection_1.db
            .select({ id: schema_1.restaurantDomains.id })
            .from(schema_1.restaurantDomains)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.domain, targetDomain))
            .limit(1);
        if (existing.length > 0) {
            return {
                label,
                domain: targetDomain,
                available: false,
                reason: "taken",
                message: `The domain '${targetDomain}' is already registered to another restaurant.`,
            };
        }
    }
    catch (dbErr) {
        console.error("[isSubdomainAvailable] Database lookup error:", dbErr?.message);
        throw dbErr;
    }
    // d) Plesk check: does targetDomain exist in Plesk?
    // If Plesk is unreachable, fail closed with 'check_unavailable' (never pass silently)
    const pleskEnabled = process.env.ENABLE_PLESK_PROVISIONING === "true";
    if (pleskEnabled) {
        try {
            const pleskDomains = await getPleskDomains();
            if (pleskDomains.has(targetDomain)) {
                return {
                    label,
                    domain: targetDomain,
                    available: false,
                    reason: "exists_on_server",
                    message: `The domain '${targetDomain}' already exists on the hosting server.`,
                };
            }
        }
        catch (pleskErr) {
            console.error("[isSubdomainAvailable] Plesk connectivity error:", pleskErr?.message);
            return {
                label,
                domain: targetDomain,
                available: false,
                reason: "check_unavailable",
                message: "Hosting server is currently unreachable. Availability cannot be confirmed at this time.",
            };
        }
    }
    // e) Optional DNS record check
    if (process.env.CHECK_DNS_FOR_SUBDOMAIN === "true") {
        try {
            const isWildcard = await hasWildcardDns(rootZone);
            if (isWildcard) {
                console.warn(`[Subdomain] Wildcard DNS detected for '${rootZone}'. Skipping DNS record check for '${targetDomain}'.`);
            }
            else {
                // Check for A, AAAA, CNAME, MX, TXT records
                const checks = await Promise.allSettled([
                    dns_1.default.promises.resolve4(targetDomain),
                    dns_1.default.promises.resolve6(targetDomain),
                    dns_1.default.promises.resolveCname(targetDomain),
                    dns_1.default.promises.resolveMx(targetDomain),
                    dns_1.default.promises.resolveTxt(targetDomain),
                ]);
                const hasRecord = checks.some((c) => c.status === "fulfilled" && Array.isArray(c.value) && c.value.length > 0);
                if (hasRecord) {
                    return {
                        label,
                        domain: targetDomain,
                        available: false,
                        reason: "dns_record_exists",
                        message: `A DNS record already exists for '${targetDomain}'.`,
                    };
                }
            }
        }
        catch (dnsErr) {
            console.warn("[isSubdomainAvailable] DNS check warning:", dnsErr?.message);
        }
    }
    // All checks passed!
    return {
        label,
        domain: targetDomain,
        available: true,
    };
}
