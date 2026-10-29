/**
 * Plesk REST API client – all calls go through the Plesk /api/v2/cli/:command/call endpoint.
 * NO child_process, NO shell commands built from user input.
 * Secrets (API key) are never logged.
 *
 * PLESK_HOSTING_MODE:
 *   'site'  (default) – creates a standalone Plesk site + nginx reverse-proxy (Phase 2 & 3)
 *   'alias'           – creates a site_alias under MAIN_DOMAIN (Phase 1 legacy)
 */

import axios from "axios";
import dns from "dns";
import fs from "fs/promises";
import path from "path";
import { parse } from "tldts";
import { db } from "../models/connection";
import { restaurantDomains } from "../models/schema";
import { eq } from "drizzle-orm";
import { invalidatePleskDomainsCache } from "./subdomainAvailability";

// ─── In-process provision lock ─────────────────────────────────────────────
const provisioningInProgress = new Set<number>();

export function isProvisionLocked(domainId: number): boolean {
  return provisioningInProgress.has(domainId);
}

export function acquireProvisionLock(domainId: number): boolean {
  if (provisioningInProgress.has(domainId)) return false;
  provisioningInProgress.add(domainId);
  return true;
}

export function releaseProvisionLock(domainId: number): void {
  provisioningInProgress.delete(domainId);
}
// ───────────────────────────────────────────────────────────────────────────

const HOSTNAME_REGEX =
  /^(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Validate a hostname against the strict regex (no protocol, path, port, or spaces). */
export function isValidHostname(domain: string): boolean {
  return HOSTNAME_REGEX.test(domain);
}

export interface PleskCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute a Plesk CLI command via the REST API.
 * Throws if the HTTP call fails. Returns `{ code, stdout, stderr }`.
 * A non-zero `code` is NOT thrown here – callers decide how to handle it.
 */
export async function pleskCli(
  command: string,
  params: string[]
): Promise<PleskCliResult> {
  const pleskUrl = process.env.PLESK_URL;
  const apiKey = process.env.PLESK_API_KEY;

  if (!pleskUrl || !apiKey) {
    throw new Error("PLESK_URL or PLESK_API_KEY is not configured");
  }

  const url = `${pleskUrl}/api/v2/cli/${command}/call`;

  const response = await axios.post<PleskCliResult>(
    url,
    { params },
    {
      headers: {
        "Content-Type": "application/json",
        // Never log this key – it is only passed in the header, not in the body
        "X-API-Key": apiKey,
      },
      httpsAgent: undefined,
      timeout: 60_000,
    }
  );

  return response.data;
}

/** Check whether a domain resolves to SERVER_IP or MAIN_DOMAIN (non-blocking info). */
export async function pointsToServer(domain: string): Promise<boolean> {
  const serverIp = process.env.SERVER_IP;
  const mainDomain = process.env.MAIN_DOMAIN;

  try {
    // Try A record first
    const addresses = await dns.promises
      .resolve4(domain)
      .catch(() => [] as string[]);
    if (serverIp && addresses.includes(serverIp)) return true;

    // Try CNAME
    const cnames = await dns.promises
      .resolveCname(domain)
      .catch(() => [] as string[]);
    if (
      mainDomain &&
      cnames.some((c) => c === mainDomain || c === `${mainDomain}.`)
    )
      return true;

    return false;
  } catch {
    return false;
  }
}

/** Detect whether a domain is an apex (no subdomain). */
export function isApexDomain(domain: string): boolean {
  const parsed = parse(domain);
  return parsed.subdomain === "" || parsed.subdomain === null;
}

// ─── Env helpers ────────────────────────────────────────────────────────────
function env(key: string): string {
  return (process.env[key] ?? "").trim();
}

function hostingMode(): "site" | "alias" {
  return (process.env.PLESK_HOSTING_MODE ?? "site") === "alias"
    ? "alias"
    : "site";
}

/** Detect Let's Encrypt rate-limit errors so we can mark as retryable. */
function isRateLimitError(msg: string): boolean {
  return /too many (certificates|requests)|rate.?limit/i.test(msg);
}

// ─── Provision result type ──────────────────────────────────────────────────
export interface ProvisionResult {
  success: boolean;
  error?: string;
  step?: string;
}

// ─── Persist provision progress to DB ───────────────────────────────────────
async function persistStep(
  domainId: number,
  updates: Record<string, unknown>
): Promise<void> {
  try {
    await db
      .update(restaurantDomains)
      .set(updates as any)
      .where(eq(restaurantDomains.id, domainId));
  } catch (err: any) {
    console.error(
      `[Plesk] Failed to persist provision step for domain ${domainId}:`,
      err?.message
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  SITE-MODE provisioning (Phase 2 & Phase 3)
//  Steps (resumable – each persisted to provision_step before advancing):
//    0. Safety checks
//    1. site_created  – create Plesk site inside PLESK_WEBSPACE
//    2. dns_check     – verify A/CNAME points to our server (waiting for DNS)
//    3. cert_issued   – Let's Encrypt SSL
//    4. proxy_applied – write nginx reverse-proxy config
// ────────────────────────────────────────────────────────────────────────────
async function provisionSite(
  domainId: number,
  domain: string,
  source: "external" | "managed" | "subdomain",
  currentStep: string | null | undefined
): Promise<ProvisionResult> {
  const rootZone = (env("ROOT_ZONE") || "keeto.org").toLowerCase();
  const mainDomain = (env("MAIN_DOMAIN") || "orderfood.keeto.org").toLowerCase();
  const pleskWebspace = (env("PLESK_WEBSPACE") || rootZone).toLowerCase();
  const proxyTarget = env("PLESK_PROXY_TARGET") || `https://${mainDomain}`;
  const serverIp = env("SERVER_IP");
  const adminEmail = env("ADMIN_EMAIL");
  const manageDns = process.env.PLESK_MANAGE_DNS === "true";

  // ── Step 0: Safety checks ──────────────────────────────────────────────
  if (!isValidHostname(domain)) {
    return { success: false, error: `Invalid hostname: ${domain}`, step: "safety" };
  }

  // Refuse protected platform domains
  const forbidden = [
    mainDomain,
    pleskWebspace,
    rootZone,
    "keeto.org",
  ];
  if (forbidden.includes(domain.toLowerCase())) {
    return {
      success: false,
      error: `Refused: ${domain} is a protected platform domain`,
      step: "safety",
    };
  }

  // Safety rules: external & managed cannot be under rootZone / keeto.org
  if (source !== "subdomain") {
    if (
      domain.toLowerCase().endsWith(`.${rootZone}`) ||
      domain.toLowerCase().endsWith(".keeto.org")
    ) {
      return {
        success: false,
        error: `Refused: ${domain} is under protected zone ${rootZone}`,
        step: "safety",
      };
    }
  } else {
    // source='subdomain' must be exactly <single-label>.<rootZone>
    const suffix = `.${rootZone}`;
    if (!domain.toLowerCase().endsWith(suffix)) {
      return {
        success: false,
        error: `Refused: ${domain} must end with ${suffix}`,
        step: "safety",
      };
    }
    const label = domain.toLowerCase().slice(0, -suffix.length);
    if (!label || label.includes(".")) {
      return {
        success: false,
        error: `Refused: ${domain} must be a single-label subdomain under ${rootZone}`,
        step: "safety",
      };
    }
  }

  // ── Step 1: site_created ───────────────────────────────────────────────
  if (!currentStep || currentStep === null) {
    // Check if domain already exists in Plesk (we did NOT create it)
    let existsInPlesk = false;
    try {
      const infoResult = await pleskCli("domain", ["--info", domain]);
      existsInPlesk = infoResult.code === 0;
    } catch {
      existsInPlesk = false;
    }

    // Fetch whether plesk_site_created is already set
    let weCreatedIt = false;
    try {
      const rows = await db
        .select({ pleskSiteCreated: restaurantDomains.pleskSiteCreated })
        .from(restaurantDomains)
        .where(eq(restaurantDomains.id, domainId))
        .limit(1);
      weCreatedIt = (rows[0]?.pleskSiteCreated ?? 0) === 1;
    } catch {}

    if (existsInPlesk && !weCreatedIt) {
      return {
        success: false,
        error: `Domain ${domain} already exists in Plesk and is not managed by this system`,
        step: "site_created",
      };
    }

    if (!existsInPlesk) {
      // Create site
      const createParams = [
        "--create",
        domain,
        "-webspace-name",
        pleskWebspace,
        "-hosting",
        "true",
      ];

      // Mail: always off; DNS zone: only if PLESK_MANAGE_DNS=true AND source='managed'
      if (manageDns && source === "managed") {
        createParams.push("-dns", "true");
      } else {
        createParams.push("-dns", "false");
      }

      let createResult = await pleskCli("site", createParams);

      // If site --create failed and source is subdomain, try subdomain --create as fallback
      if (
        createResult.code !== 0 &&
        source === "subdomain" &&
        !createResult.stdout.toLowerCase().includes("already exists") &&
        !createResult.stderr.toLowerCase().includes("already exists")
      ) {
        const label = domain.toLowerCase().replace(new RegExp(`\\.${rootZone}$`), "");
        const subResult = await pleskCli("subdomain", [
          "--create",
          label,
          "-domain",
          rootZone,
        ]);
        if (
          subResult.code === 0 ||
          subResult.stdout.toLowerCase().includes("already exists") ||
          subResult.stderr.toLowerCase().includes("already exists")
        ) {
          createResult = subResult;
        }
      }

      if (
        createResult.code !== 0 &&
        !createResult.stdout.toLowerCase().includes("already exists") &&
        !createResult.stderr.toLowerCase().includes("already exists")
      ) {
        return {
          success: false,
          error: `Plesk site creation failed: ${createResult.stderr || createResult.stdout}`,
          step: "site_created",
        };
      }

      // Invalidate cached domains list
      invalidatePleskDomainsCache();

      // Mark that WE created this site
      await persistStep(domainId, {
        pleskSiteCreated: 1,
        provisionStep: "site_created",
        provisionStatus: "running",
      });
    } else {
      // Site already exists and we created it (resume scenario)
      await persistStep(domainId, {
        provisionStep: "site_created",
        provisionStatus: "running",
      });
    }

    currentStep = "site_created";
  }

  // ── Step 2: dns_check ──────────────────────────────────────────────────
  if (currentStep === "site_created") {
    const points = await pointsToServer(domain);
    if (!points) {
      // Not pointing yet – wait for DNS, cron will retry
      const waitMsg =
        source === "subdomain"
          ? "Waiting for DNS"
          : "DNS does not point to the server yet – retrying later";

      await persistStep(domainId, {
        provisionStatus: "running",
        sslStatus: "pending",
        lastError: waitMsg,
      });
      return {
        success: false,
        error: waitMsg,
        step: "dns_check",
      };
    }
    await persistStep(domainId, { provisionStep: "dns_check" });
    currentStep = "dns_check";
  }

  // ── Step 3: cert_issued ────────────────────────────────────────────────
  if (currentStep === "dns_check" || currentStep === "site_created") {
    if (!adminEmail) {
      return {
        success: false,
        error: "ADMIN_EMAIL not set – cannot issue Let's Encrypt certificate",
        step: "cert_issued",
      };
    }

    const leParams = [
      "--exec",
      "letsencrypt",
      "cli.php",
      "-d",
      domain,
      "-m",
      adminEmail,
    ];

    // For apex domains: also include www.<domain> if it resolves to us
    if (isApexDomain(domain)) {
      const wwwPoints = await pointsToServer(`www.${domain}`);
      if (wwwPoints) {
        leParams.push("-d", `www.${domain}`);
      }
    }

    const sslResult = await pleskCli("extension", leParams);

    if (sslResult.code !== 0) {
      const errMsg = sslResult.stderr || sslResult.stdout || "Unknown SSL error";
      const isRateLimit = isRateLimitError(errMsg);
      // Clean error – never include secrets
      const cleanError = `Let's Encrypt failed: ${errMsg.substring(0, 400)}`;

      await persistStep(domainId, {
        sslStatus: "failed",
        lastError: cleanError,
        // Keep provisionStep at 'dns_check' so next retry re-attempts cert
        provisionStep: "dns_check",
        provisionStatus: isRateLimit ? "running" : "failed",
      });

      return {
        success: false,
        error: cleanError,
        step: "cert_issued",
      };
    }

    // Try to enable HTTPS redirect (best-effort, non-fatal)
    try {
      await pleskCli("site", [
        "--update",
        domain,
        "-redirect-to-ssl",
        "true",
      ]);
    } catch {
      // non-fatal
    }

    await persistStep(domainId, {
      sslStatus: "active",
      lastError: null,
      provisionStep: "cert_issued",
    });
    currentStep = "cert_issued";
  }

  // ── Step 4: proxy_applied ──────────────────────────────────────────────
  if (currentStep === "cert_issued" || currentStep === "dns_check") {
    // Derive the Host header value from MAIN_DOMAIN (strip https://)
    const proxyHost = mainDomain.replace(/^https?:\/\//, "");

    const nginxConfig = `
location ~ ^/(?!\\.well-known/) {
    proxy_pass ${proxyTarget};
    proxy_ssl_server_name on;
    proxy_set_header Host ${proxyHost};
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 60s;
    proxy_connect_timeout 10s;
}
`.trim();

    const confPath = `/var/www/vhosts/system/${domain}/conf/vhost_nginx.conf`;
    let nginxApplied = false;

    // Attempt 1: write the file directly
    try {
      await fs.mkdir(path.dirname(confPath), { recursive: true });
      await fs.writeFile(confPath, nginxConfig, { encoding: "utf8" });
      const repairResult = await pleskCli("repair", [
        "--web",
        "-domain",
        domain,
      ]);
      if (repairResult.code === 0) {
        nginxApplied = true;
      } else {
        console.warn(
          `[Plesk] repair --web returned code ${repairResult.code}: ${repairResult.stderr}`
        );
      }
    } catch (fsErr: any) {
      console.warn(
        `[Plesk] Could not write nginx config file directly (${fsErr?.message}). Trying Plesk REST API fallback.`
      );
    }

    // Attempt 2: Plesk REST API for nginx additional directives (fallback)
    if (!nginxApplied) {
      try {
        const pleskUrl = env("PLESK_URL");
        const apiKey = process.env.PLESK_API_KEY;
        if (pleskUrl && apiKey) {
          await axios.put(
            `${pleskUrl}/api/v2/domains/${encodeURIComponent(domain)}/hosting/settings`,
            {
              nginx_directives: nginxConfig,
            },
            {
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey,
              },
              timeout: 30_000,
            }
          );
          nginxApplied = true;
        }
      } catch (apiErr: any) {
        console.warn(
          `[Plesk] REST API nginx directive fallback failed: ${apiErr?.message}`
        );
      }
    }

    if (!nginxApplied) {
      console.error(
        `[Plesk] WARNING: Could not apply nginx reverse-proxy config for ${domain}. Manual intervention needed.`
      );
      await persistStep(domainId, {
        lastError:
          "Nginx proxy config could not be applied automatically. Manual intervention needed.",
        provisionStep: "cert_issued",
        provisionStatus: "failed",
      });
      return {
        success: false,
        error: "Nginx proxy config could not be applied",
        step: "proxy_applied",
      };
    }

    await persistStep(domainId, {
      provisionStep: "proxy_applied",
      provisionStatus: "done",
      lastError: null,
    });
  }

  return { success: true, step: "proxy_applied" };
}

// ────────────────────────────────────────────────────────────────────────────
//  ALIAS-MODE provisioning (Phase 1 legacy – kept behind PLESK_HOSTING_MODE='alias')
// ────────────────────────────────────────────────────────────────────────────
async function provisionAlias(
  domain: string,
  source: "external" | "managed" | "subdomain"
): Promise<ProvisionResult> {
  const mainDomain = env("MAIN_DOMAIN");
  const serverIp = env("SERVER_IP");
  const adminEmail = env("ADMIN_EMAIL");

  if (!mainDomain) return { success: false, error: "MAIN_DOMAIN not set" };

  const aliasParams = [
    "--create",
    domain,
    "-domain",
    mainDomain,
    "-web",
    "true",
    "-mail",
    "false",
    "-dns",
    source === "managed" ? "true" : "false",
  ];

  const aliasResult = await pleskCli("site_alias", aliasParams);

  if (
    aliasResult.code !== 0 &&
    !aliasResult.stderr.toLowerCase().includes("already exists")
  ) {
    return { success: false, error: `site_alias failed: ${aliasResult.stderr}` };
  }

  if (source === "managed" && serverIp) {
    for (const host of ["@", "www"]) {
      const dnsResult = await pleskCli("dns", [
        "--add",
        "-domain",
        domain,
        "-type",
        "A",
        "-host",
        host,
        "-value",
        serverIp,
        "-ttl",
        "3600",
      ]);
      if (
        dnsResult.code !== 0 &&
        !dnsResult.stderr.toLowerCase().includes("already exists")
      ) {
        console.warn(
          `[Plesk] DNS add for ${host}.${domain} returned code ${dnsResult.code}: ${dnsResult.stderr}`
        );
      }
    }
  }

  if (isApexDomain(domain)) {
    const wwwDomain = `www.${domain}`;
    const resolvesToUs = await pointsToServer(wwwDomain);
    if (resolvesToUs) {
      const wwwResult = await pleskCli("site_alias", [
        "--create",
        wwwDomain,
        "-domain",
        mainDomain,
        "-web",
        "true",
        "-mail",
        "false",
        "-dns",
        "false",
      ]);
      if (
        wwwResult.code !== 0 &&
        !wwwResult.stderr.toLowerCase().includes("already exists")
      ) {
        console.warn(`[Plesk] www alias creation failed: ${wwwResult.stderr}`);
      }
    }
  }

  if (!adminEmail) {
    return { success: false, error: "ADMIN_EMAIL not set for Let's Encrypt" };
  }

  const sslResult = await pleskCli("extension", [
    "--exec",
    "letsencrypt",
    "cli.php",
    "-d",
    domain,
    "-m",
    adminEmail,
  ]);

  if (sslResult.code !== 0) {
    return {
      success: false,
      error: `Let's Encrypt failed: ${sslResult.stderr || sslResult.stdout}`,
    };
  }

  return { success: true };
}

// ────────────────────────────────────────────────────────────────────────────
//  Public provisionDomain() – dispatches to site or alias mode
// ────────────────────────────────────────────────────────────────────────────

/**
 * Provision (or resume provisioning) a custom domain.
 *
 * @param domainId    DB id of the restaurant_domains row
 * @param domain      hostname string
 * @param source      'external' | 'managed' | 'subdomain'
 * @param currentStep current provision_step from DB (to resume idempotently)
 *
 * Never throws. Returns { success, error?, step }.
 */
export async function provisionDomain(
  domainId: number,
  domain: string,
  source: "external" | "managed" | "subdomain",
  currentStep?: string | null
): Promise<ProvisionResult> {
  if (!isValidHostname(domain)) {
    return { success: false, error: `Invalid hostname: ${domain}` };
  }

  try {
    if (hostingMode() === "alias") {
      return await provisionAlias(domain, source);
    } else {
      return await provisionSite(domainId, domain, source, currentStep);
    }
  } catch (err: any) {
    const safeMsg = (err?.message ?? "Unknown error").replace(
      /x-api-key[^,}]*/gi,
      "[redacted]"
    );
    return { success: false, error: safeMsg };
  }
}

/**
 * Delete a domain from Plesk.
 * In site-mode: uses `site --remove` (only if we created the site).
 * In alias-mode: uses `site_alias --delete`.
 * pleskSiteCreated=1 means we created the Plesk site; only then do we delete it.
 */
export async function deletePleskDomain(
  domain: string,
  pleskSiteCreated: number
): Promise<{ success: boolean; error?: string }> {
  invalidatePleskDomainsCache();

  if (hostingMode() === "alias") {
    const result = await pleskCli("site_alias", ["--delete", domain]);
    if (result.code !== 0 && !result.stderr.toLowerCase().includes("not found")) {
      return { success: false, error: result.stderr };
    }
    return { success: true };
  }

  // Site-mode: only remove if we created it
  if (!pleskSiteCreated) {
    console.warn(
      `[Plesk] Skipping site removal for ${domain} – not created by this system`
    );
    return { success: true };
  }

  let result = await pleskCli("site", ["--remove", domain, "-force-remove", "true"]);

  // If site --remove failed with not found, and domain is a subdomain, try subdomain --remove
  if (result.code !== 0) {
    const rootZone = (env("ROOT_ZONE") || "keeto.org").toLowerCase();
    const suffix = `.${rootZone}`;
    if (domain.toLowerCase().endsWith(suffix)) {
      const label = domain.toLowerCase().slice(0, -suffix.length);
      try {
        const subResult = await pleskCli("subdomain", [
          "--remove",
          label,
          "-domain",
          rootZone,
        ]);
        if (subResult.code === 0) {
          result = subResult;
        }
      } catch {
        // keep original result
      }
    }
  }

  if (result.code !== 0 && !result.stderr.toLowerCase().includes("not found")) {
    return { success: false, error: result.stderr };
  }
  return { success: true };
}

/**
 * @deprecated Use deletePleskDomain() instead.
 */
export async function deletePleskAlias(
  domain: string
): Promise<{ success: boolean; error?: string }> {
  return deletePleskDomain(domain, 1);
}
