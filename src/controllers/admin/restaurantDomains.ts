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
  deletePleskAlias,
  pointsToServer,
} from "../../utils/pleskClient";
import { domainResolutionCache } from "../../utils/domainCache";

const MAIN_DOMAIN = () =>
  (process.env.MAIN_DOMAIN ?? "orderfood.keeto.org").toLowerCase();

const pleskEnabled = () =>
  process.env.ENABLE_PLESK_PROVISIONING === "true";

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
  };
  domainResolutionCache.set(host, result);
  res.status(200).json(result);
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
      createdAt: restaurantDomains.createdAt,
    })
    .from(restaurantDomains)
    .where(eq(restaurantDomains.restaurantId, restaurantId));

  SuccessResponse(res, domains);
};

// --------------------------------------------------------------------------
// POST /api/superadmin/restaurants/:id/domains
// body: { domain: string, source?: 'external' | 'managed' }
// --------------------------------------------------------------------------
export const addDomain = async (req: Request, res: Response) => {
  const restaurantId = req.params.id;
  const { domain, source = "external" } = req.body as {
    domain: string;
    source: "external" | "managed";
  };

  // Verify restaurant exists
  const rest = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  if (!rest.length) throw new NotFound("Restaurant not found");

  // Duplicate check
  const existing = await db
    .select({ id: restaurantDomains.id })
    .from(restaurantDomains)
    .where(eq(restaurantDomains.domain, domain))
    .limit(1);
  if (existing.length) throw new ConflictError("Domain already registered");

  const apex = isApexDomain(domain) ? 1 : 0;

  if (source === "external") {
    // Generate a 32-byte (64 hex chars) random verification token
    const token = crypto.randomBytes(32).toString("hex");

    await db.insert(restaurantDomains).values({
      restaurantId,
      domain,
      isApex: apex,
      source: "external",
      verificationToken: token,
      verified: 0,
      sslStatus: "pending",
    });

    const inserted = await db
      .select()
      .from(restaurantDomains)
      .where(eq(restaurantDomains.domain, domain))
      .limit(1);

    const mainDomain = MAIN_DOMAIN();
    const dnsRecords =
      apex === 0
        ? // Subdomain: CNAME + TXT
          [
            { type: "CNAME", name: domain, value: mainDomain },
            {
              type: "TXT",
              name: `_keeto-verify.${domain}`,
              value: `keeto-verification=${token}`,
            },
          ]
        : // Apex: A + TXT
          [
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

  // source === 'managed'
  await db.insert(restaurantDomains).values({
    restaurantId,
    domain,
    isApex: apex,
    source: "managed",
    verificationToken: null,
    verified: 1, // managed domains skip verification
    sslStatus: "pending",
  });

  const inserted = await db
    .select()
    .from(restaurantDomains)
    .where(eq(restaurantDomains.domain, domain))
    .limit(1);

  // Run Plesk provisioning immediately if enabled
  if (pleskEnabled()) {
    // Non-blocking — run in background
    setImmediate(async () => {
      try {
        const result = await provisionDomain(domain, "managed");
        await db
          .update(restaurantDomains)
          .set({
            sslStatus: result.success ? "active" : "failed",
            lastError: result.error ?? null,
          })
          .where(eq(restaurantDomains.domain, domain));
      } catch (err: any) {
        console.error("[Plesk] provisionDomain error:", err?.message);
        await db
          .update(restaurantDomains)
          .set({
            sslStatus: "failed",
            lastError: err?.message ?? "Unknown provisioning error",
          })
          .where(eq(restaurantDomains.domain, domain))
          .catch(console.error);
      }
    });
  }

  res.status(201).json({
    id: inserted[0].id,
    domain,
    source: "managed",
    is_apex: apex === 1,
    verified: true,
    ssl_status: pleskEnabled() ? "provisioning" : "pending",
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
  const txtName =
    record.isApex === 1
      ? `_keeto-verify.${record.domain}`
      : `_keeto-verify.${record.domain}`;
  // For apex: the TXT name is `_keeto-verify` directly under the domain,
  // but from the resolver perspective we query `_keeto-verify.<domain>`
  const lookupHost = `_keeto-verify.${record.domain}`;

  let verified = false;
  try {
    const txtRecords = await dns.promises.resolveTxt(lookupHost);
    verified = txtRecords.some((chunks) =>
      chunks.join("").includes(expectedValue)
    );
  } catch (err: any) {
    // ENOTFOUND / ENODATA are expected when records don't exist yet
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
    .set({ verified: 1 })
    .where(eq(restaurantDomains.id, domainId));

  // Evict from cache so it becomes visible on the next resolve-domain call
  domainResolutionCache.delete(record.domain);

  // Non-blocking: run provisioning if enabled
  let provisioning = false;
  if (pleskEnabled()) {
    provisioning = true;
    setImmediate(async () => {
      try {
        const result = await provisionDomain(record.domain, "external");
        await db
          .update(restaurantDomains)
          .set({
            sslStatus: result.success ? "active" : "failed",
            lastError: result.error ?? null,
          })
          .where(eq(restaurantDomains.id, domainId));
      } catch (err: any) {
        console.error("[Plesk] provisionDomain error:", err?.message);
        await db
          .update(restaurantDomains)
          .set({
            sslStatus: "failed",
            lastError: err?.message ?? "Unknown provisioning error",
          })
          .where(eq(restaurantDomains.id, domainId))
          .catch(console.error);
      }
    });
  }

  // Non-blocking pointsToServer check
  const pts = await pointsToServer(record.domain).catch(() => false);

  res.status(200).json({
    verified: true,
    pointsToServer: pts,
    provisioningStarted: provisioning,
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

  // Run in foreground so the caller knows the result
  const result = await provisionDomain(
    record.domain,
    record.source as "external" | "managed"
  );

  await db
    .update(restaurantDomains)
    .set({
      sslStatus: result.success ? "active" : "failed",
      lastError: result.error ?? null,
    })
    .where(eq(restaurantDomains.id, domainId));

  SuccessResponse(res, {
    success: result.success,
    sslStatus: result.success ? "active" : "failed",
    error: result.error,
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

  // Delete Plesk alias if provisioning is enabled (non-blocking)
  if (pleskEnabled()) {
    deletePleskAlias(record.domain).catch((err) =>
      console.error("[Plesk] deletePleskAlias error:", err?.message)
    );
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
