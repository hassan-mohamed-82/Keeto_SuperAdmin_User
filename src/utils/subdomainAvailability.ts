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

import crypto from "crypto";
import dns from "dns";
import { db } from "../models/connection";
import { restaurantDomains } from "../models/schema";
import { eq } from "drizzle-orm";
import { pleskCli } from "./pleskClient";

export type SubdomainUnavailableReason =
  | "invalid"
  | "reserved"
  | "taken"
  | "exists_on_server"
  | "check_unavailable"
  | "dns_record_exists";

export interface SubdomainAvailabilityResult {
  label: string;
  domain: string;
  available: boolean;
  reason?: SubdomainUnavailableReason;
  message?: string;
}

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

function getRootZone(): string {
  return (process.env.ROOT_ZONE || "keeto.org").trim().toLowerCase();
}

function getReservedSubdomains(): Set<string> {
  const envList = (process.env.RESERVED_SUBDOMAINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const merged = new Set([...DEFAULT_RESERVED, ...envList]);
  return merged;
}

// ─── 60-Second In-Memory Cache for Plesk Domain & Alias List ────────────────
interface PleskDomainsCache {
  domains: Set<string>;
  fetchedAt: number;
}
let pleskCache: PleskDomainsCache | null = null;
const PLESK_CACHE_TTL_MS = 60_000;

async function getPleskDomains(): Promise<Set<string>> {
  const now = Date.now();
  if (pleskCache && now - pleskCache.fetchedAt < PLESK_CACHE_TTL_MS) {
    return pleskCache.domains;
  }

  const domains = new Set<string>();

  // Fetch domains / sites / subdomains from Plesk
  const domResult = await pleskCli("domain", ["--list"]);
  if (domResult.code !== 0) {
    throw new Error(`Plesk domain --list returned error code ${domResult.code}: ${domResult.stderr}`);
  }

  for (const line of domResult.stdout.split(/\r?\n/)) {
    const d = line.trim().toLowerCase();
    if (d) domains.add(d);
  }

  // Also fetch aliases if supported
  try {
    const aliasResult = await pleskCli("domalias", ["--list"]);
    if (aliasResult.code === 0) {
      for (const line of aliasResult.stdout.split(/\r?\n/)) {
        const a = line.trim().toLowerCase();
        if (a) domains.add(a);
      }
    }
  } catch {
    // domalias --list might not have items or command name differs; non-fatal
  }

  pleskCache = {
    domains,
    fetchedAt: now,
  };

  return domains;
}

/** Invalidate the Plesk domain cache (e.g. after adding a domain) */
export function invalidatePleskDomainsCache(): void {
  pleskCache = null;
}

// ─── Subdomain Label Validator ──────────────────────────────────────────────
export function isValidSubdomainLabel(label: string): boolean {
  if (!label || typeof label !== "string") return false;
  if (label.length < 3 || label.length > 30) return false;
  // lowercase alphanumeric and hyphens
  if (!/^[a-z0-9-]+$/.test(label)) return false;
  // no leading or trailing hyphens
  if (label.startsWith("-") || label.endsWith("-")) return false;
  // no consecutive hyphens
  if (label.includes("--")) return false;
  return true;
}

// ─── Wildcard DNS Check Helper ──────────────────────────────────────────────
async function hasWildcardDns(rootZone: string): Promise<boolean> {
  const randomLabel = `wld-${crypto.randomBytes(8).toString("hex")}.${rootZone}`;
  try {
    const [aRecords, cnameRecords] = await Promise.all([
      dns.promises.resolve4(randomLabel).catch(() => [] as string[]),
      dns.promises.resolveCname(randomLabel).catch(() => [] as string[]),
    ]);
    return aRecords.length > 0 || cnameRecords.length > 0;
  } catch {
    return false;
  }
}

// ─── Main Availability Check ────────────────────────────────────────────────
/**
 * Check whether a subdomain label is available under ROOT_ZONE.
 * Stops at first failure in required order.
 */
export async function isSubdomainAvailable(
  rawLabel: string
): Promise<SubdomainAvailabilityResult> {
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
      message:
        "Subdomain label must be 3-30 lowercase alphanumeric characters and single hyphens, cannot start or end with a hyphen, and cannot contain consecutive hyphens.",
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
    const existing = await db
      .select({ id: restaurantDomains.id })
      .from(restaurantDomains)
      .where(eq(restaurantDomains.domain, targetDomain))
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
  } catch (dbErr: any) {
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
    } catch (pleskErr: any) {
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
        console.warn(
          `[Subdomain] Wildcard DNS detected for '${rootZone}'. Skipping DNS record check for '${targetDomain}'.`
        );
      } else {
        // Check for A, AAAA, CNAME, MX, TXT records
        const checks = await Promise.allSettled([
          dns.promises.resolve4(targetDomain),
          dns.promises.resolve6(targetDomain),
          dns.promises.resolveCname(targetDomain),
          dns.promises.resolveMx(targetDomain),
          dns.promises.resolveTxt(targetDomain),
        ]);

        const hasRecord = checks.some(
          (c) => c.status === "fulfilled" && Array.isArray(c.value) && c.value.length > 0
        );

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
    } catch (dnsErr: any) {
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
