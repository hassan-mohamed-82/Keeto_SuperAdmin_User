/**
 * Plesk REST API client — all calls go through the Plesk /api/v2/cli/:command/call endpoint.
 * NO child_process, NO shell commands built from user input.
 * Secrets (API key) are never logged.
 */

import axios, { AxiosError } from "axios";
import dns from "dns";
import { parse } from "tldts";

const HOSTNAME_REGEX =
  /^(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/** Validate a hostname against the strict regex (no protocol, path, port, or spaces). */
export function isValidHostname(domain: string): boolean {
  return HOSTNAME_REGEX.test(domain);
}

interface PleskCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Execute a Plesk CLI command via the REST API.
 * Throws if the HTTP call fails. Returns `{ code, stdout, stderr }`.
 * A non-zero `code` is NOT thrown here — callers decide how to handle it.
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
        // Never log this key — it is only passed in the header, not in the body
        "X-API-Key": apiKey,
      },
      // Reject self-signed certs in production; PLESK_URL must use a valid cert
      httpsAgent: undefined,
      timeout: 30_000,
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
    const addresses = await dns.promises.resolve4(domain).catch(() => [] as string[]);
    if (serverIp && addresses.includes(serverIp)) return true;

    // Try CNAME
    const cnames = await dns.promises.resolveCname(domain).catch(() => [] as string[]);
    if (mainDomain && cnames.some((c) => c === mainDomain || c === `${mainDomain}.`))
      return true;

    return false;
  } catch {
    return false;
  }
}

/** Provision a domain as a Plesk site alias and issue Let's Encrypt SSL. */
export async function provisionDomain(
  domain: string,
  source: "external" | "managed"
): Promise<{ success: boolean; error?: string }> {
  // 1. Validate the domain strictly before touching Plesk
  if (!isValidHostname(domain)) {
    return { success: false, error: `Invalid hostname: ${domain}` };
  }

  const mainDomain = process.env.MAIN_DOMAIN;
  const serverIp = process.env.SERVER_IP;
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!mainDomain) return { success: false, error: "MAIN_DOMAIN not set" };

  // 2. Create the site alias
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

  // 3. For managed domains: ensure A records exist for @ and www
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
      // Idempotent: ignore "already exists" errors
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

  // 4. For apex domains: also try to create www.<domain> alias if it resolves to us
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
        console.warn(
          `[Plesk] www alias creation failed: ${wwwResult.stderr}`
        );
      }
    }
  }

  // 5. Issue Let's Encrypt SSL
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
    // Keep the alias but mark SSL as failed — do NOT roll back
    return {
      success: false,
      error: `Let's Encrypt failed: ${sslResult.stderr || sslResult.stdout}`,
    };
  }

  return { success: true };
}

/** Delete the Plesk site alias for a domain. */
export async function deletePleskAlias(
  domain: string
): Promise<{ success: boolean; error?: string }> {
  const result = await pleskCli("site_alias", ["--delete", domain]);
  if (result.code !== 0 && !result.stderr.toLowerCase().includes("not found")) {
    return { success: false, error: result.stderr };
  }
  return { success: true };
}

/** Detect whether a domain is an apex (no subdomain). */
export function isApexDomain(domain: string): boolean {
  const parsed = parse(domain);
  return parsed.subdomain === "" || parsed.subdomain === null;
}
