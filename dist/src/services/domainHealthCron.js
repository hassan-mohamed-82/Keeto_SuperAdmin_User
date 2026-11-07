"use strict";
/**
 * Background cron jobs for custom domain health checks and provisioning retries.
 *
 * Jobs:
 *  1. Daily at 02:00 – DNS health check for all verified external domains.
 *  2. Every PROVISION_RETRY_MINUTES – retry provisioning for domains in
 *     'running' (stale) or 'failed' state, within PROVISION_MAX_HOURS.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDomainHealthCron = initDomainHealthCron;
const node_cron_1 = __importDefault(require("node-cron"));
const dns_1 = __importDefault(require("dns"));
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const domainCache_1 = require("../utils/domainCache");
const pleskClient_1 = require("../utils/pleskClient");
const MAIN_DOMAIN = () => (process.env.MAIN_DOMAIN ?? "orderfood.keeto.org").toLowerCase();
const SERVER_IP = () => process.env.SERVER_IP ?? "";
// ─── Daily DNS health check ─────────────────────────────────────────────────
/** Check whether a domain's DNS still points to our server. */
async function dnsPointsToUs(domain, isApex) {
    try {
        if (!isApex) {
            // Subdomain – check CNAME
            const cnames = await dns_1.default.promises
                .resolveCname(domain)
                .catch(() => []);
            const main = MAIN_DOMAIN();
            if (cnames.some((c) => c === main || c === `${main}.`))
                return true;
        }
        // Also check A record for both apex and subdomain fallback
        const addresses = await dns_1.default.promises
            .resolve4(domain)
            .catch(() => []);
        const ip = SERVER_IP();
        if (ip && addresses.includes(ip))
            return true;
        return false;
    }
    catch {
        return false;
    }
}
async function runDomainHealthCheck() {
    console.log("[DomainCron] Starting daily domain health check...");
    try {
        // Only external, verified domains
        const domains = await connection_1.db
            .select()
            .from(schema_1.restaurantDomains)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.source, "external"), (0, drizzle_orm_1.eq)(schema_1.restaurantDomains.verified, 1)));
        const now = new Date();
        for (const record of domains) {
            try {
                const pointsToUs = await dnsPointsToUs(record.domain, record.isApex ?? 0);
                const updates = {
                    lastCheckedAt: now,
                };
                if (!pointsToUs) {
                    updates.lastError = "DNS no longer points to the server";
                    // Evict from cache so the frontend gets the stale result immediately removed
                    domainCache_1.domainResolutionCache.delete(record.domain);
                }
                else if (record.lastError === "DNS no longer points to the server") {
                    // Clear the error if DNS is healthy again
                    updates.lastError = null;
                }
                await connection_1.db
                    .update(schema_1.restaurantDomains)
                    .set(updates)
                    .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, record.id));
            }
            catch (err) {
                console.error(`[DomainCron] Error checking domain ${record.domain}:`, err?.message);
            }
        }
        // Flag domains with ssl_status = 'failed' or 'pending' for > 24 hours
        const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const staleDomains = await connection_1.db
            .select({
            id: schema_1.restaurantDomains.id,
            domain: schema_1.restaurantDomains.domain,
            sslStatus: schema_1.restaurantDomains.sslStatus,
        })
            .from(schema_1.restaurantDomains)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.sslStatus, "failed"), (0, drizzle_orm_1.eq)(schema_1.restaurantDomains.sslStatus, "pending")), (0, drizzle_orm_1.lt)(schema_1.restaurantDomains.createdAt, cutoff)));
        for (const d of staleDomains) {
            console.warn(`[DomainCron] Domain ${d.domain} has ssl_status=${d.sslStatus} for >24h`);
            await connection_1.db
                .update(schema_1.restaurantDomains)
                .set({
                lastError: `SSL has been in '${d.sslStatus}' state for more than 24 hours. Manual intervention may be needed.`,
            })
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, d.id));
        }
        console.log(`[DomainCron] Done. Checked ${domains.length} domain(s), found ${staleDomains.length} stale SSL domain(s).`);
    }
    catch (err) {
        console.error("[DomainCron] Fatal error in domain health check:", err?.message);
    }
}
// ─── Provisioning retry job ─────────────────────────────────────────────────
async function runProvisioningRetry() {
    if (process.env.ENABLE_PLESK_PROVISIONING !== "true")
        return;
    const retryMinutes = parseInt(process.env.PROVISION_RETRY_MINUTES ?? "10", 10);
    const maxHours = parseInt(process.env.PROVISION_MAX_HOURS ?? "24", 10);
    const now = new Date();
    // Stale = provision_started_at older than retryMinutes (or NULL)
    const staleThreshold = new Date(now.getTime() - retryMinutes * 60000);
    // Max age for retrying (don't retry domains older than PROVISION_MAX_HOURS)
    const maxAgeThreshold = new Date(now.getTime() - maxHours * 60 * 60000);
    console.log("[ProvisionCron] Running provisioning retry sweep...");
    try {
        // Find verified domains that need provisioning:
        //   - provision_status IN ('failed','running') where running is stale
        //   - AND created_at within PROVISION_MAX_HOURS
        const domainsToRetry = await connection_1.db
            .select()
            .from(schema_1.restaurantDomains)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.verified, 1), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.provisionStatus, "failed"), 
        // Stale 'running': started more than retryMinutes ago
        (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.provisionStatus, "running"), (0, drizzle_orm_1.lte)(schema_1.restaurantDomains.provisionStartedAt, staleThreshold)), 
        // Also retry idle domains whose ssl_status is pending/failed
        (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.provisionStatus, "idle"), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.sslStatus, "pending"), (0, drizzle_orm_1.eq)(schema_1.restaurantDomains.sslStatus, "failed"))))));
        // Filter out domains older than PROVISION_MAX_HOURS
        const eligible = domainsToRetry.filter((d) => d.createdAt && new Date(d.createdAt) > maxAgeThreshold);
        console.log(`[ProvisionCron] Found ${eligible.length} domain(s) to retry provisioning.`);
        for (const record of eligible) {
            if ((0, pleskClient_1.isProvisionLocked)(record.id)) {
                console.log(`[ProvisionCron] Domain ${record.id} is locked – skipping`);
                continue;
            }
            if (!(0, pleskClient_1.acquireProvisionLock)(record.id))
                continue;
            // Mark as running & increment attempts
            await connection_1.db
                .update(schema_1.restaurantDomains)
                .set({
                provisionStatus: "running",
                provisionStartedAt: now,
                provisionAttempts: (0, drizzle_orm_1.sql) `${schema_1.restaurantDomains.provisionAttempts} + 1`,
            })
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, record.id));
            // Run in background (don't block the cron loop)
            (async () => {
                try {
                    const result = await (0, pleskClient_1.provisionDomain)(record.id, record.domain, record.source, record.provisionStep);
                    if (result.success) {
                        await connection_1.db
                            .update(schema_1.restaurantDomains)
                            .set({ sslStatus: "active", lastError: null })
                            .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, record.id));
                    }
                    console.log(`[ProvisionCron] Domain ${record.domain}: ${result.success ? "✅ done" : `❌ ${result.error}`}`);
                }
                catch (err) {
                    console.error(`[ProvisionCron] Unexpected error for domain ${record.domain}:`, err?.message);
                    await connection_1.db
                        .update(schema_1.restaurantDomains)
                        .set({
                        provisionStatus: "failed",
                        sslStatus: "failed",
                        lastError: err?.message ?? "Unexpected provisioning error",
                    })
                        .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, record.id))
                        .catch(console.error);
                }
                finally {
                    (0, pleskClient_1.releaseProvisionLock)(record.id);
                }
            })();
        }
    }
    catch (err) {
        console.error("[ProvisionCron] Fatal error in provisioning retry sweep:", err?.message);
    }
}
// ─── Initialize all cron jobs ─────────────────────────────────────────────
/** Initialize all domain cron jobs. Call once at server startup. */
function initDomainHealthCron() {
    const retryMinutes = parseInt(process.env.PROVISION_RETRY_MINUTES ?? "10", 10);
    const validMinutes = Math.max(1, Math.min(retryMinutes, 59)); // clamp to 1-59
    console.log(`🕐 Domain Health Cron initialized – daily DNS check at 02:00`);
    console.log(`🔁 Provisioning Retry Cron initialized – every ${validMinutes} minute(s)`);
    // 1. Daily DNS health check at 02:00
    node_cron_1.default.schedule("0 2 * * *", async () => {
        try {
            await runDomainHealthCheck();
        }
        catch (err) {
            console.error("[DomainCron] Unhandled error:", err?.message);
        }
    });
    // 2. Provisioning retry on configurable interval
    node_cron_1.default.schedule(`*/${validMinutes} * * * *`, async () => {
        try {
            await runProvisioningRetry();
        }
        catch (err) {
            console.error("[ProvisionCron] Unhandled error:", err?.message);
        }
    });
}
