/**
 * Daily background job for custom domain health checks.
 * - Re-checks DNS for verified external domains.
 * - Flags domains whose SSL is failed/pending for > 24 hours.
 * Runs once per day at 02:00 AM server time.
 */

import cron from "node-cron";
import dns from "dns";
import { db } from "../models/connection";
import { restaurantDomains } from "../models/schema";
import { eq, and, lt, or, sql } from "drizzle-orm";
import { domainResolutionCache } from "../utils/domainCache";

const MAIN_DOMAIN = () =>
  (process.env.MAIN_DOMAIN ?? "orderfood.keeto.org").toLowerCase();
const SERVER_IP = () => process.env.SERVER_IP ?? "";

/** Check whether a domain's DNS still points to our server. */
async function dnsPointsToUs(domain: string, isApex: number): Promise<boolean> {
  try {
    if (!isApex) {
      // Subdomain — check CNAME
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
      .select({ id: restaurantDomains.id, domain: restaurantDomains.domain, sslStatus: restaurantDomains.sslStatus })
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
        `[DomainCron] Domain ${d.domain} has ssl_status=${d.sslStatus} for > 24h`
      );
      // Update last_error to surface the issue without deleting the record
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
    console.error("[DomainCron] Fatal error in domain health check:", err?.message);
  }
}

/** Initialize the daily cron job. Call once at server startup. */
export function initDomainHealthCron() {
  console.log("⏰ Domain Health Cron initialized — runs daily at 02:00");

  // Run at 02:00 every day
  cron.schedule("0 2 * * *", async () => {
    try {
      await runDomainHealthCheck();
    } catch (err: any) {
      console.error("[DomainCron] Unhandled error:", err?.message);
    }
  });
}
