/**
 * DNS Provider abstraction for subdomains under ROOT_ZONE.
 * Supported providers:
 *  - 'plesk': Adds the A record directly to the zone via Plesk CLI.
 *  - 'none': External DNS / manual configuration (returns manual_required + dnsAction instructions).
 * Never deletes or overwrites existing records.
 */

import { pleskCli } from "./pleskClient";

export interface DnsActionDetails {
  type: "A";
  name: string;
  value: string;
  zone: string;
  note: string;
}

export interface DnsActionResult {
  status: "created" | "manual_required" | "not_needed";
  dnsAction?: DnsActionDetails;
  error?: string;
}

function getRootZone(): string {
  return (process.env.ROOT_ZONE || "keeto.org").trim().toLowerCase();
}

function getServerIp(): string {
  return (process.env.SERVER_IP || "").trim();
}

/**
 * Ensure an A record exists for `label` pointing to `serverIp` under `rootZone`.
 *
 * @param label     Single-label name (e.g. "flaky")
 * @param serverIp  Destination IPv4
 * @param rootZone  Parent zone (e.g. "keeto.org")
 */
export async function ensureARecord(
  label: string,
  serverIp: string = getServerIp(),
  rootZone: string = getRootZone()
): Promise<DnsActionResult> {
  const provider = (process.env.DNS_PROVIDER || "none").trim().toLowerCase();

  const manualAction: DnsActionDetails = {
    type: "A",
    name: label,
    value: serverIp || "<SERVER_IP>",
    zone: rootZone,
    note: "Add this record at the DNS provider unless a wildcard record exists",
  };

  if (!serverIp) {
    console.warn("[DnsProvider] SERVER_IP not set in env; manual record required");
    return {
      status: "manual_required",
      dnsAction: manualAction,
    };
  }

  // 1. Plesk DNS provider: add via Plesk CLI
  if (provider === "plesk") {
    try {
      // Verified Plesk command: plesk bin dns --add <zone> -a <subdomain> -ip <ip>
      // Returns code 0 on success, code 2 if record already exists
      const result = await pleskCli("dns", [
        "--add",
        rootZone,
        "-a",
        label,
        "-ip",
        serverIp,
      ]);

      if (
        result.code === 0 ||
        result.code === 2 ||
        result.stderr.toLowerCase().includes("already exists") ||
        result.stdout.toLowerCase().includes("already exists")
      ) {
        console.log(`[DnsProvider:plesk] A record for ${label}.${rootZone} -> ${serverIp} ensured.`);
        return { status: "created" };
      }

      console.warn(
        `[DnsProvider:plesk] Failed to add DNS record on Plesk (code ${result.code}: ${result.stderr}). Falling back to manual_required.`
      );
      return {
        status: "manual_required",
        dnsAction: manualAction,
        error: result.stderr || result.stdout,
      };
    } catch (err: any) {
      console.warn(
        `[DnsProvider:plesk] Plesk DNS call threw error (${err?.message}). Falling back to manual_required.`
      );
      return {
        status: "manual_required",
        dnsAction: manualAction,
        error: err?.message,
      };
    }
  }

  // 2. Default: none / external DNS -> manual_required
  return {
    status: "manual_required",
    dnsAction: manualAction,
  };
}
