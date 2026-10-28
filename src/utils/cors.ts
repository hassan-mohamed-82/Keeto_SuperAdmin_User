import { db } from "../models/connection";
import { restaurantDomains } from "../models/schema";
import { eq, and } from "drizzle-orm";
import { domainResolutionCache } from "./domainCache";

/**
 * Checks whether an incoming request Origin is allowed.
 * - Requests without Origin are allowed (server-to-server, curl, mobile apps).
 * - Origins ending with .keeto.org (or keeto.org) are allowed.
 * - Custom domains are allowed only if verified in restaurant_domains.
 * - Uses in-memory cache for fast lookup.
 */
export async function isAllowedOrigin(origin?: string): Promise<boolean> {
  if (!origin) return true;

  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  // Any keeto.org domain or subdomain
  if (hostname === "keeto.org" || hostname.endsWith(".keeto.org")) {
    return true;
  }

  // Check in-memory cache
  const cached = domainResolutionCache.get(hostname);
  if (cached !== undefined) {
    return cached !== null;
  }

  // Check database
  try {
    const rows = await db
      .select({ id: restaurantDomains.id })
      .from(restaurantDomains)
      .where(
        and(
          eq(restaurantDomains.domain, hostname),
          eq(restaurantDomains.verified, 1)
        )
      )
      .limit(1);

    if (rows.length > 0) {
      return true;
    } else {
      domainResolutionCache.setNegative(hostname);
      return false;
    }
  } catch (err) {
    console.error("[CORS] Database check failed for origin:", origin, err);
    return false;
  }
}
