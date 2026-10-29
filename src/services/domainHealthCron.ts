/**
 * Background cron jobs for custom domain health checks and provisioning retries.
 *
 * Jobs:
 *  1. Daily at 02:00 – DNS health check for all verified external domains.
 *  2. Every PROVISION_RETRY_MINUTES – retry provisioning for domains in
 *     'running' (stale) or 'failed' state, within PROVISION_MAX_HOURS.
 */

import cron from "node-cron";
import dns from "dns";
import { db } from "../models/connection";
import { restaurantDomains } from "../models/schema";
import { eq, and, lt, or, lte, sql } from "drizzle-orm";
import { domainResolutionCache } from "../utils/domainCache";
import {
  provisionDomain,
  acquireProvisionLock,
  releaseProvisionLock,
  isProvisionLocked,
} from "../utils/pleskClient";

const MAIN_DOMAIN = () =>
  (process.env.MAIN_DOMAIN ?? "orderfood.keeto.org").toLowerCase();
const SERVER_IP = () => process.env.SERVER_IP ?? "";

// ─── Daily DNS health check ─────────────────────────────────────────────────

/** Check whether a domain's DNS still points to our server. */
async function dnsPointsToUs(domain: string, isApex: number): Promise<boolean> {
  try {
    if (!isApex) {
      // Subdomain – check CNAME
      const cnames = await dns.promises
        .resolveCname(domain)
        .catch(() => [] as string[]);
      const main = MAIN_DOMAIN();
      if (cnames.some((c) => c === main || c === `${main}.`)) return true;
    }

    // Also check A record for both apex and subdomain fallback
    const addresses = await dns.promises
      .resolve4(domain)
      .catch(() => [] as string[]);
    const ip = SERVER_IP();
    if (ip && addresses.includes(ip)) return true;

    return false;
  } catch {
    return false;
  }
}

async function runDomainHealthCheck() {
  console.log("[DomainCron] Starting daily domain health check...");

  try {
    // Only external, verified domains
    const domains = await db
      .select()
      .from(restaurantDomains)
      .where(
        and(
          eq(restaurantDomains.source, "external"),
          eq(restaurantDomains.verified, 1)
        )
      );

    const now = new Date();

    for (const record of domains) {
      try {
        const pointsToUs = await dnsPointsToUs(
          record.domain,
          record.isApex ?? 0
        );

        const updates: Record<string, any> = {
          lastCheckedAt: now,
        };

        if (!pointsToUs) {
          updates.lastError = "DNS no longer points to the server";
          // Evict from cache so the frontend gets the stale result immediately removed
          domainResolutionCache.delete(record.domain);
        } else if (record.lastError === "DNS no longer points to the server") {
          // Clear the error if DNS is healthy again
          updates.lastError = null;
        }

        await db
          .update(restaurantDomains)
          .set(updates)
          .where(eq(restaurantDomains.id, record.id));
      } catch (err: any) {
        console.error(
          `[DomainCron] Error checking domain ${record.domain}:`,
          err?.message
        );
      }
    }

    // Flag domains with ssl_status = 'failed' or 'pending' for > 24 hours
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const staleDomains = await db
      .select({
        id: restaurantDomains.id,
        domain: restaurantDomains.domain,
        sslStatus: restaurantDomains.sslStatus,
      })
      .from(restaurantDomains)
      .where(
        and(
          or(
            eq(restaurantDomains.sslStatus, "failed"),
            eq(restaurantDomains.sslStatus, "pending")
          ),
          lt(restaurantDomains.createdAt, cutoff)
        )
      );

    for (const d of staleDomains) {
      console.warn(
        `[DomainCron] Domain ${d.domain} has ssl_status=${d.sslStatus} for >24h`
      );
      await db
        .update(restaurantDomains)
        .set({
          lastError: `SSL has been in '${d.sslStatus}' state for more than 24 hours. Manual intervention may be needed.`,
        })
        .where(eq(restaurantDomains.id, d.id));
    }

    console.log(
      `[DomainCron] Done. Checked ${domains.length} domain(s), found ${staleDomains.length} stale SSL domain(s).`
    );
  } catch (err: any) {
    console.error(
      "[DomainCron] Fatal error in domain health check:",
      err?.message
    );
  }
}

// ─── Provisioning retry job ─────────────────────────────────────────────────

async function runProvisioningRetry() {
  if (process.env.ENABLE_PLESK_PROVISIONING !== "true") return;

  const retryMinutes = parseInt(process.env.PROVISION_RETRY_MINUTES ?? "10", 10);
  const maxHours = parseInt(process.env.PROVISION_MAX_HOURS ?? "24", 10);

  const now = new Date();
  // Stale = provision_started_at older than retryMinutes (or NULL)
  const staleThreshold = new Date(now.getTime() - retryMinutes * 60_000);
  // Max age for retrying (don't retry domains older than PROVISION_MAX_HOURS)
  const maxAgeThreshold = new Date(now.getTime() - maxHours * 60 * 60_000);

  console.log("[ProvisionCron] Running provisioning retry sweep...");

  try {
    // Find verified domains that need provisioning:
    //   - provision_status IN ('failed','running') where running is stale
    //   - AND created_at within PROVISION_MAX_HOURS
    const domainsToRetry = await db
      .select()
      .from(restaurantDomains)
      .where(
        and(
          eq(restaurantDomains.verified, 1),
          or(
            eq(restaurantDomains.provisionStatus, "failed"),
            // Stale 'running': started more than retryMinutes ago
            and(
              eq(restaurantDomains.provisionStatus, "running"),
              lte(restaurantDomains.provisionStartedAt, staleThreshold)
            ),
            // Also retry idle domains whose ssl_status is pending/failed
            and(
              eq(restaurantDomains.provisionStatus, "idle"),
              or(
                eq(restaurantDomains.sslStatus, "pending"),
                eq(restaurantDomains.sslStatus, "failed")
              )
            )
          )
        )
      );

    // Filter out domains older than PROVISION_MAX_HOURS
    const eligible = domainsToRetry.filter(
      (d) => d.createdAt && new Date(d.createdAt) > maxAgeThreshold
    );

    console.log(
      `[ProvisionCron] Found ${eligible.length} domain(s) to retry provisioning.`
    );

    for (const record of eligible) {
      if (isProvisionLocked(record.id)) {
        console.log(`[ProvisionCron] Domain ${record.id} is locked – skipping`);
        continue;
      }

      if (!acquireProvisionLock(record.id)) continue;

      // Mark as running & increment attempts
      await db
        .update(restaurantDomains)
        .set({
          provisionStatus: "running",
          provisionStartedAt: now,
          provisionAttempts: sql`${restaurantDomains.provisionAttempts} + 1`,
        })
        .where(eq(restaurantDomains.id, record.id));

      // Run in background (don't block the cron loop)
      (async () => {
        try {
          const result = await provisionDomain(
            record.id,
            record.domain,
            record.source as "external" | "managed" | "subdomain",
            record.provisionStep
          );

          if (result.success) {
            await db
              .update(restaurantDomains)
              .set({ sslStatus: "active", lastError: null })
              .where(eq(restaurantDomains.id, record.id));
          }

          console.log(
            `[ProvisionCron] Domain ${record.domain}: ${result.success ? "✅ done" : `❌ ${result.error}`}`
          );
        } catch (err: any) {
          console.error(
            `[ProvisionCron] Unexpected error for domain ${record.domain}:`,
            err?.message
          );
          await db
            .update(restaurantDomains)
            .set({
              provisionStatus: "failed",
              sslStatus: "failed",
              lastError: err?.message ?? "Unexpected provisioning error",
            })
            .where(eq(restaurantDomains.id, record.id))
            .catch(console.error);
        } finally {
          releaseProvisionLock(record.id);
        }
      })();
    }
  } catch (err: any) {
    console.error(
      "[ProvisionCron] Fatal error in provisioning retry sweep:",
      err?.message
    );
  }
}

// ─── Initialize all cron jobs ─────────────────────────────────────────────

/** Initialize all domain cron jobs. Call once at server startup. */
export function initDomainHealthCron() {
  const retryMinutes = parseInt(process.env.PROVISION_RETRY_MINUTES ?? "10", 10);
  const validMinutes = Math.max(1, Math.min(retryMinutes, 59)); // clamp to 1-59

  console.log(`🕐 Domain Health Cron initialized – daily DNS check at 02:00`);
  console.log(
    `🔁 Provisioning Retry Cron initialized – every ${validMinutes} minute(s)`
  );

  // 1. Daily DNS health check at 02:00
  cron.schedule("0 2 * * *", async () => {
    try {
      await runDomainHealthCheck();
    } catch (err: any) {
      console.error("[DomainCron] Unhandled error:", err?.message);
    }
  });

  // 2. Provisioning retry on configurable interval
  cron.schedule(`*/${validMinutes} * * * *`, async () => {
    try {
      await runProvisioningRetry();
    } catch (err: any) {
      console.error("[ProvisionCron] Unhandled error:", err?.message);
    }
  });
}
