import { Request, Response } from "express";
import crypto from "crypto";
import dns from "dns";
import { db } from "../../models/connection";
import { restaurantDomains, restaurants } from "../../models/schema";
import { eq, and, sql } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import {
  NotFound,
  ConflictError,
  BadRequest,
  AppError,
} from "../../Errors";
import {
  isApexDomain,
  isValidHostname,
  provisionDomain,
  deletePleskDomain,
  pointsToServer,
  acquireProvisionLock,
  releaseProvisionLock,
  isProvisionLocked,
} from "../../utils/pleskClient";
import { domainResolutionCache } from "../../utils/domainCache";
import { isSubdomainAvailable } from "../../utils/subdomainAvailability";
import { ensureARecord } from "../../utils/dnsProvider";

const MAIN_DOMAIN = () =>
  (process.env.MAIN_DOMAIN ?? "orderfood.keeto.org").toLowerCase();

const ROOT_ZONE = () =>
  (process.env.ROOT_ZONE ?? "keeto.org").toLowerCase();

const pleskEnabled = () =>
  process.env.ENABLE_PLESK_PROVISIONING === "true";

// --------------------------------------------------------------------------
// Helper: start background provisioning for a domain record
// Acquires lock, sets provision_status='running', then runs provisionDomain.
// Updates DB when done. Never throws.
// --------------------------------------------------------------------------
function startBackgroundProvisioning(
  domainId: number,
  domain: string,
  source: "external" | "managed" | "subdomain",
  currentStep?: string | null
): void {
  if (!acquireProvisionLock(domainId)) {
    console.log(`[Plesk] Domain ${domainId} already provisioning – skipping`);
    return;
  }

  setImmediate(async () => {
    const startedAt = new Date();
    try {
      // Mark as running
      await db
        .update(restaurantDomains)
        .set({
          provisionStatus: "running",
          provisionStartedAt: startedAt,
          provisionAttempts: sql`${restaurantDomains.provisionAttempts} + 1`,
        })
        .where(eq(restaurantDomains.id, domainId));

      const result = await provisionDomain(domainId, domain, source, currentStep);

      if (result.success) {
        await db
          .update(restaurantDomains)
          .set({ sslStatus: "active", lastError: null })
          .where(eq(restaurantDomains.id, domainId));
      } else {
        console.error(`[Plesk] Provisioning ended for domain ${domainId}: ${result.error}`);
      }
    } catch (err: any) {
      console.error("[Plesk] Unexpected error in background provisioning:", err?.message);
      await db
        .update(restaurantDomains)
        .set({
          provisionStatus: "failed",
          sslStatus: "failed",
          lastError: err?.message ?? "Unknown provisioning error",
        })
        .where(eq(restaurantDomains.id, domainId))
        .catch(console.error);
    } finally {
      releaseProvisionLock(domainId);
    }
  });
}

// --------------------------------------------------------------------------
// PUBLIC: GET /api/resolve-domain?host=...
// --------------------------------------------------------------------------
export const resolveDomain = async (req: Request, res: Response) => {
  const host = ((req.query.host as string) ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, ""); // strip port

  if (!host || !isValidHostname(host)) {
    res.status(400).json({ error: "Invalid host parameter" });
    return;
  }

  // Check positive cache
  const cached = domainResolutionCache.get(host);
  if (cached !== undefined) {
    if (cached === null) {
      res.status(404).json({ error: "Domain not found" });
      return;
    }
    res.status(200).json(cached);
    return;
  }

  // DB lookup
  const rows = await db
    .select({
      restaurantSlug: restaurants.slug,
      name: restaurants.name,
      id: restaurants.id,
    })
    .from(restaurantDomains)
    .innerJoin(restaurants, eq(restaurantDomains.restaurantId, restaurants.id))
    .where(
      and(
        eq(restaurantDomains.domain, host),
        eq(restaurantDomains.verified, 1)
      )
    )
    .limit(1);

  if (!rows.length || !rows[0].restaurantSlug) {
    domainResolutionCache.setNegative(host);
    res.status(404).json({ error: "Domain not found" });
    return;
  }

  const result = {
    restaurantSlug: rows[0].restaurantSlug,
    name: rows[0].name,
    id: rows[0].id,
  };
  domainResolutionCache.set(host, result);
  res.status(200).json(result);
};

// --------------------------------------------------------------------------
// GET /api/admin/domains/check-subdomain?label=flaky
// --------------------------------------------------------------------------
export const checkSubdomain = async (req: Request, res: Response) => {
  const label = ((req.query.label as string) ?? "").trim().toLowerCase();
  const result = await isSubdomainAvailable(label);

  res.status(200).json({
    label: result.label,
    domain: result.domain,
    available: result.available,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.message ? { message: result.message } : {}),
  });
};

// --------------------------------------------------------------------------
// GET /api/superadmin/restaurants/:id/domains
// --------------------------------------------------------------------------
export const listDomains = async (req: Request, res: Response) => {
  const restaurantId = req.params.id;

  // Verify restaurant exists
  const rest = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!rest.length) throw new NotFound("Restaurant not found");

  const domains = await db
    .select({
      id: restaurantDomains.id,
      domain: restaurantDomains.domain,
      isApex: restaurantDomains.isApex,
      source: restaurantDomains.source,
      verified: restaurantDomains.verified,
      sslStatus: restaurantDomains.sslStatus,
      lastError: restaurantDomains.lastError,
      provisionStatus: restaurantDomains.provisionStatus,
      provisionStep: restaurantDomains.provisionStep,
      pleskSiteCreated: restaurantDomains.pleskSiteCreated,
      provisionAttempts: restaurantDomains.provisionAttempts,
      provisionStartedAt: restaurantDomains.provisionStartedAt,
      dnsStatus: restaurantDomains.dnsStatus,
      createdAt: restaurantDomains.createdAt,
    })
    .from(restaurantDomains)
    .where(eq(restaurantDomains.restaurantId, restaurantId));

  SuccessResponse(res, domains);
};

// --------------------------------------------------------------------------
// POST /api/superadmin/restaurants/:id/domains
// body: { domain: string, source?: 'external' | 'managed' } OR { label: string, source: 'subdomain' }
// --------------------------------------------------------------------------
export const addDomain = async (req: Request, res: Response) => {
  const restaurantId = req.params.id;
  const body = req.body as {
    domain?: string;
    label?: string;
    source?: "external" | "managed" | "subdomain";
  };
  const source = body.source ?? "external";

  // Verify restaurant exists
  const rest = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!rest.length) throw new NotFound("Restaurant not found");

  // ── Source: SUBDOMAIN ───────────────────────────────────────────────────
  if (source === "subdomain") {
    const rawLabel = (body.label ?? "").trim().toLowerCase();
    const check = await isSubdomainAvailable(rawLabel);

    if (!check.available) {
      if (check.reason === "taken") {
        res.status(409).json({ error: check.message, reason: check.reason });
        return;
      }
      res.status(400).json({ error: check.message, reason: check.reason });
      return;
    }

    const fullDomain = check.domain;

    // Check duplicate in DB
    const existing = await db
      .select({ id: restaurantDomains.id })
      .from(restaurantDomains)
      .where(eq(restaurantDomains.domain, fullDomain))
      .limit(1);

    if (existing.length) {
      res.status(409).json({
        error: `Domain '${fullDomain}' already registered`,
        reason: "taken",
      });
      return;
    }

    // Ensure DNS A record
    let dnsResult;
    try {
      dnsResult = await ensureARecord(check.label);
    } catch (dnsErr: any) {
      res.status(400).json({
        error: dnsErr?.message || "Failed to configure DNS record",
        reason: "dns_error",
      });
      return;
    }

    try {
      await db.insert(restaurantDomains).values({
        restaurantId,
        domain: fullDomain,
        isApex: 0,
        source: "subdomain",
        verificationToken: null,
        verified: 1, // We own the zone, verified immediately
        sslStatus: "pending",
        provisionStatus: pleskEnabled() ? "running" : "idle",
        dnsStatus: dnsResult.status,
      });
    } catch (dbErr: any) {
      if (
        dbErr?.message?.includes("Duplicate") ||
        dbErr?.code === "ER_DUP_ENTRY"
      ) {
        res.status(409).json({
          error: `Domain '${fullDomain}' already registered`,
          reason: "taken",
        });
        return;
      }
      throw dbErr;
    }

    const inserted = await db
      .select()
      .from(restaurantDomains)
      .where(eq(restaurantDomains.domain, fullDomain))
      .limit(1);

    const newId = inserted[0].id;

    if (pleskEnabled()) {
      startBackgroundProvisioning(newId, fullDomain, "subdomain");
    }

    res.status(201).json({
      id: newId,
      domain: fullDomain,
      source: "subdomain",
      verified: true,
      provision_status: pleskEnabled() ? "running" : "idle",
      dns_status: dnsResult.status,
      ...(dnsResult.dnsAction ? { dnsAction: dnsResult.dnsAction } : {}),
    });
    return;
  }

  // ── Source: EXTERNAL or MANAGED ─────────────────────────────────────────
  const domain = body.domain!;

  // Duplicate check
  const existing = await db
    .select({ id: restaurantDomains.id })
    .from(restaurantDomains)
    .where(eq(restaurantDomains.domain, domain))
    .limit(1);
  if (existing.length) throw new ConflictError("Domain already registered");

  const apex = isApexDomain(domain) ? 1 : 0;

  if (source === "external") {
    const token = crypto.randomBytes(32).toString("hex");

    await db.insert(restaurantDomains).values({
      restaurantId,
      domain,
      isApex: apex,
      source: "external",
      verificationToken: token,
      verified: 0,
      sslStatus: "pending",
      provisionStatus: "idle",
      dnsStatus: "not_needed",
    });

    const inserted = await db
      .select()
      .from(restaurantDomains)
      .where(eq(restaurantDomains.domain, domain))
      .limit(1);

    const mainDomain = MAIN_DOMAIN();
    const dnsRecords =
      apex === 0
        ? [
            { type: "CNAME", name: domain, value: mainDomain },
            {
              type: "TXT",
              name: `_keeto-verify.${domain}`,
              value: `keeto-verification=${token}`,
            },
          ]
        : [
            { type: "A", name: "@", value: process.env.SERVER_IP ?? "<SERVER_IP>" },
            {
              type: "TXT",
              name: "_keeto-verify",
              value: `keeto-verification=${token}`,
            },
          ];

    const note =
      apex === 1
        ? `If your DNS provider supports ALIAS/ANAME/CNAME flattening, you can point @ to ${mainDomain} instead of using an A record.`
        : undefined;

    res.status(201).json({
      id: inserted[0].id,
      domain,
      source: "external",
      is_apex: apex === 1,
      dnsRecords,
      ...(note ? { note } : {}),
    });
    return;
  }

  // source === 'managed' – auto-verified, start provisioning immediately
  await db.insert(restaurantDomains).values({
    restaurantId,
    domain,
    isApex: apex,
    source: "managed",
    verificationToken: null,
    verified: 1, // managed domains skip verification
    sslStatus: "pending",
    provisionStatus: pleskEnabled() ? "running" : "idle",
    dnsStatus: "not_needed",
  });

  const inserted = await db
    .select()
    .from(restaurantDomains)
    .where(eq(restaurantDomains.domain, domain))
    .limit(1);

  const newId = inserted[0].id;

  if (pleskEnabled()) {
    startBackgroundProvisioning(newId, domain, "managed");
  }

  res.status(201).json({
    id: newId,
    domain,
    source: "managed",
    is_apex: apex === 1,
    verified: true,
    provision_status: pleskEnabled() ? "running" : "idle",
    ssl_status: "pending",
  });
};

// --------------------------------------------------------------------------
// POST /api/superadmin/domains/:domainId/verify
// --------------------------------------------------------------------------
export const verifyDomain = async (req: Request, res: Response) => {
  const domainId = parseInt(req.params.domainId, 10);
  if (isNaN(domainId)) throw new BadRequest("Invalid domain ID");

  const rows = await db
    .select()
    .from(restaurantDomains)
    .where(eq(restaurantDomains.id, domainId))
    .limit(1);

  if (!rows.length) throw new NotFound("Domain not found");
  const record = rows[0];

  if (record.source !== "external") {
    throw new BadRequest("Only external domains require TXT verification");
  }
  if (record.verified === 1) {
    res.status(200).json({ verified: true, pointsToServer: true, alreadyVerified: true });
    return;
  }
  if (!record.verificationToken) {
    throw new AppError("Domain has no verification token", 422);
  }

  const expectedValue = `keeto-verification=${record.verificationToken}`;
  const lookupHost = `_keeto-verify.${record.domain}`;

  let verified = false;
  try {
    const txtRecords = await dns.promises.resolveTxt(lookupHost);
    verified = txtRecords.some((chunks) =>
      chunks.join("").includes(expectedValue)
    );
  } catch (err: any) {
    if (!["ENOTFOUND", "ENODATA", "ENOENT"].includes(err.code)) {
      console.error("[verifyDomain] DNS error:", err);
    }
  }

  if (!verified) {
    res.status(400).json({ verified: false });
    return;
  }

  // Mark verified
  await db
    .update(restaurantDomains)
    .set({
      verified: 1,
      provisionStatus: pleskEnabled() ? "running" : "idle",
    })
    .where(eq(restaurantDomains.id, domainId));

  domainResolutionCache.delete(record.domain);

  if (pleskEnabled()) {
    startBackgroundProvisioning(
      domainId,
      record.domain,
      "external",
      record.provisionStep
    );
  }

  const pts = await pointsToServer(record.domain).catch(() => false);

  res.status(200).json({
    verified: true,
    pointsToServer: pts,
    provisioningStarted: pleskEnabled(),
  });
};

// --------------------------------------------------------------------------
// POST /api/superadmin/domains/:domainId/provision  (manual retry)
// --------------------------------------------------------------------------
export const retryProvisioning = async (req: Request, res: Response) => {
  const domainId = parseInt(req.params.domainId, 10);
  if (isNaN(domainId)) throw new BadRequest("Invalid domain ID");

  const rows = await db
    .select()
    .from(restaurantDomains)
    .where(eq(restaurantDomains.id, domainId))
    .limit(1);

  if (!rows.length) throw new NotFound("Domain not found");
  const record = rows[0];

  if (record.verified !== 1) {
    throw new BadRequest("Domain must be verified before provisioning");
  }

  if (!pleskEnabled()) {
    throw new BadRequest(
      "ENABLE_PLESK_PROVISIONING is disabled. Enable it in env to run provisioning."
    );
  }

  // Return 409 if provisioning is already running for this domain
  if (isProvisionLocked(domainId)) {
    res.status(409).json({
      error: "Provisioning is already running for this domain",
      provision_status: "running",
    });
    return;
  }

  // Also check DB: if status is 'running' and started recently (within PROVISION_RETRY_MINUTES)
  if (record.provisionStatus === "running" && record.provisionStartedAt) {
    const retryMinutes = parseInt(
      process.env.PROVISION_RETRY_MINUTES ?? "10",
      10
    );
    const elapsed =
      (Date.now() - new Date(record.provisionStartedAt).getTime()) / 60_000;
    if (elapsed < retryMinutes) {
      res.status(409).json({
        error: "Provisioning is already running for this domain",
        provision_status: "running",
        started_at: record.provisionStartedAt,
      });
      return;
    }
  }

  // Start background provisioning and return 202 immediately
  startBackgroundProvisioning(
    domainId,
    record.domain,
    record.source as "external" | "managed" | "subdomain",
    record.provisionStep
  );

  res.status(202).json({
    provision_status: "running",
    domain: record.domain,
    message: "Provisioning started in background",
  });
};

// --------------------------------------------------------------------------
// DELETE /api/superadmin/domains/:domainId
// --------------------------------------------------------------------------
export const deleteDomain = async (req: Request, res: Response) => {
  const domainId = parseInt(req.params.domainId, 10);
  if (isNaN(domainId)) throw new BadRequest("Invalid domain ID");

  const rows = await db
    .select()
    .from(restaurantDomains)
    .where(eq(restaurantDomains.id, domainId))
    .limit(1);

  if (!rows.length) throw new NotFound("Domain not found");
  const record = rows[0];

  // Delete from DB first (FK cascade handles related data)
  await db
    .delete(restaurantDomains)
    .where(eq(restaurantDomains.id, domainId));

  // Evict from cache immediately
  domainResolutionCache.delete(record.domain);

  // Remove from Plesk if provisioning enabled (non-blocking)
  if (pleskEnabled()) {
    deletePleskDomain(record.domain, record.pleskSiteCreated ?? 0).catch(
      (err) =>
        console.error("[Plesk] deletePleskDomain error:", err?.message)
    );
  }

  // If source was 'subdomain', return a note with the DNS record admin should remove
  if (record.source === "subdomain") {
    SuccessResponse(res, {
      deleted: true,
      domain: record.domain,
      note: `DNS records were not removed automatically. Please remove the A record for '${record.domain}' from '${ROOT_ZONE()}' if no longer needed.`,
    });
    return;
  }

  SuccessResponse(res, { deleted: true, domain: record.domain });
};

// --------------------------------------------------------------------------
// POST /api/superadmin/domains/:domainId/set-order-link
// --------------------------------------------------------------------------
export const setOrderLink = async (req: Request, res: Response) => {
  const domainId = parseInt(req.params.domainId, 10);
  if (isNaN(domainId)) throw new BadRequest("Invalid domain ID");

  const rows = await db
    .select()
    .from(restaurantDomains)
    .where(eq(restaurantDomains.id, domainId))
    .limit(1);

  if (!rows.length) throw new NotFound("Domain not found");
  const record = rows[0];

  if (record.verified !== 1) {
    throw new BadRequest("Domain must be verified first");
  }
  if (record.sslStatus !== "active") {
    throw new BadRequest("SSL must be active before setting as order link");
  }

  await db
    .update(restaurants)
    .set({ orderLink: `https://${record.domain}` })
    .where(eq(restaurants.id, record.restaurantId));

  SuccessResponse(res, {
    restaurantId: record.restaurantId,
    orderLink: `https://${record.domain}`,
  });
};
