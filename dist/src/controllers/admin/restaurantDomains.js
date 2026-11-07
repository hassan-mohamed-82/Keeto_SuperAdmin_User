"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setOrderLink = exports.deleteDomain = exports.retryProvisioning = exports.verifyDomain = exports.addDomain = exports.listDomains = exports.checkSubdomain = exports.resolveDomain = void 0;
const crypto_1 = __importDefault(require("crypto"));
const dns_1 = __importDefault(require("dns"));
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const pleskClient_1 = require("../../utils/pleskClient");
const domainCache_1 = require("../../utils/domainCache");
const subdomainAvailability_1 = require("../../utils/subdomainAvailability");
const dnsProvider_1 = require("../../utils/dnsProvider");
const MAIN_DOMAIN = () => (process.env.MAIN_DOMAIN ?? "orderfood.keeto.org").toLowerCase();
const ROOT_ZONE = () => (process.env.ROOT_ZONE ?? "keeto.org").toLowerCase();
const pleskEnabled = () => process.env.ENABLE_PLESK_PROVISIONING === "true";
// --------------------------------------------------------------------------
// Helper: start background provisioning for a domain record
// Acquires lock, sets provision_status='running', then runs provisionDomain.
// Updates DB when done. Never throws.
// --------------------------------------------------------------------------
function startBackgroundProvisioning(domainId, domain, source, currentStep) {
    if (!(0, pleskClient_1.acquireProvisionLock)(domainId)) {
        console.log(`[Plesk] Domain ${domainId} already provisioning – skipping`);
        return;
    }
    setImmediate(async () => {
        const startedAt = new Date();
        try {
            // Mark as running
            await connection_1.db
                .update(schema_1.restaurantDomains)
                .set({
                provisionStatus: "running",
                provisionStartedAt: startedAt,
                provisionAttempts: (0, drizzle_orm_1.sql) `${schema_1.restaurantDomains.provisionAttempts} + 1`,
            })
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, domainId));
            const result = await (0, pleskClient_1.provisionDomain)(domainId, domain, source, currentStep);
            if (result.success) {
                await connection_1.db
                    .update(schema_1.restaurantDomains)
                    .set({ sslStatus: "active", lastError: null })
                    .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, domainId));
            }
            else {
                console.error(`[Plesk] Provisioning ended for domain ${domainId}: ${result.error}`);
                // If it stopped at dns_check, it's waiting for DNS (kept as running).
                // Otherwise, mark as failed and persist the exact error!
                if (result.step !== "dns_check") {
                    await connection_1.db
                        .update(schema_1.restaurantDomains)
                        .set({
                        provisionStatus: "failed",
                        lastError: result.error ?? "Provisioning failed",
                    })
                        .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, domainId))
                        .catch(console.error);
                }
            }
        }
        catch (err) {
            console.error("[Plesk] Unexpected error in background provisioning:", err?.message);
            await connection_1.db
                .update(schema_1.restaurantDomains)
                .set({
                provisionStatus: "failed",
                sslStatus: "failed",
                lastError: err?.message ?? "Unknown provisioning error",
            })
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, domainId))
                .catch(console.error);
        }
        finally {
            (0, pleskClient_1.releaseProvisionLock)(domainId);
        }
    });
}
// --------------------------------------------------------------------------
// PUBLIC: GET /api/resolve-domain?host=...
// --------------------------------------------------------------------------
const resolveDomain = async (req, res) => {
    const host = (req.query.host ?? "")
        .trim()
        .toLowerCase()
        .replace(/:\d+$/, ""); // strip port
    if (!host || !(0, pleskClient_1.isValidHostname)(host)) {
        res.status(400).json({ error: "Invalid host parameter" });
        return;
    }
    // Check positive cache
    const cached = domainCache_1.domainResolutionCache.get(host);
    if (cached !== undefined) {
        if (cached === null) {
            res.status(404).json({ error: "Domain not found" });
            return;
        }
        res.status(200).json(cached);
        return;
    }
    // DB lookup
    const rows = await connection_1.db
        .select({
        restaurantSlug: schema_1.restaurants.slug,
        name: schema_1.restaurants.name,
        id: schema_1.restaurants.id,
    })
        .from(schema_1.restaurantDomains)
        .innerJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurantDomains.restaurantId, schema_1.restaurants.id))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.domain, host), (0, drizzle_orm_1.eq)(schema_1.restaurantDomains.verified, 1)))
        .limit(1);
    if (!rows.length || !rows[0].restaurantSlug) {
        domainCache_1.domainResolutionCache.setNegative(host);
        res.status(404).json({ error: "Domain not found" });
        return;
    }
    const result = {
        restaurantSlug: rows[0].restaurantSlug,
        name: rows[0].name,
        id: rows[0].id,
    };
    domainCache_1.domainResolutionCache.set(host, result);
    res.status(200).json(result);
};
exports.resolveDomain = resolveDomain;
// --------------------------------------------------------------------------
// GET /api/admin/domains/check-subdomain?label=flaky
// --------------------------------------------------------------------------
const checkSubdomain = async (req, res) => {
    const label = (req.query.label ?? "").trim().toLowerCase();
    const result = await (0, subdomainAvailability_1.isSubdomainAvailable)(label);
    res.status(200).json({
        label: result.label,
        domain: result.domain,
        available: result.available,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.message ? { message: result.message } : {}),
    });
};
exports.checkSubdomain = checkSubdomain;
// --------------------------------------------------------------------------
// GET /api/superadmin/restaurants/:id/domains
// --------------------------------------------------------------------------
const listDomains = async (req, res) => {
    const restaurantId = req.params.id;
    // Verify restaurant exists
    const rest = await connection_1.db
        .select({ id: schema_1.restaurants.id })
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId))
        .limit(1);
    if (!rest.length)
        throw new Errors_1.NotFound("Restaurant not found");
    const domains = await connection_1.db
        .select({
        id: schema_1.restaurantDomains.id,
        domain: schema_1.restaurantDomains.domain,
        isApex: schema_1.restaurantDomains.isApex,
        source: schema_1.restaurantDomains.source,
        verified: schema_1.restaurantDomains.verified,
        sslStatus: schema_1.restaurantDomains.sslStatus,
        lastError: schema_1.restaurantDomains.lastError,
        provisionStatus: schema_1.restaurantDomains.provisionStatus,
        provisionStep: schema_1.restaurantDomains.provisionStep,
        pleskSiteCreated: schema_1.restaurantDomains.pleskSiteCreated,
        provisionAttempts: schema_1.restaurantDomains.provisionAttempts,
        provisionStartedAt: schema_1.restaurantDomains.provisionStartedAt,
        dnsStatus: schema_1.restaurantDomains.dnsStatus,
        createdAt: schema_1.restaurantDomains.createdAt,
    })
        .from(schema_1.restaurantDomains)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.restaurantId, restaurantId));
    (0, response_1.SuccessResponse)(res, domains);
};
exports.listDomains = listDomains;
// --------------------------------------------------------------------------
// POST /api/superadmin/restaurants/:id/domains
// body: { domain: string, source?: 'external' | 'managed' } OR { label: string, source: 'subdomain' }
// --------------------------------------------------------------------------
const addDomain = async (req, res) => {
    const restaurantId = req.params.id;
    const body = req.body;
    const source = body.source ?? "external";
    // Verify restaurant exists
    const rest = await connection_1.db
        .select({ id: schema_1.restaurants.id })
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId))
        .limit(1);
    if (!rest.length)
        throw new Errors_1.NotFound("Restaurant not found");
    // ── Source: SUBDOMAIN ───────────────────────────────────────────────────
    if (source === "subdomain") {
        const rawLabel = (body.label ?? "").trim().toLowerCase();
        const check = await (0, subdomainAvailability_1.isSubdomainAvailable)(rawLabel);
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
        const existing = await connection_1.db
            .select({ id: schema_1.restaurantDomains.id })
            .from(schema_1.restaurantDomains)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.domain, fullDomain))
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
            dnsResult = await (0, dnsProvider_1.ensureARecord)(check.label);
        }
        catch (dnsErr) {
            res.status(400).json({
                error: dnsErr?.message || "Failed to configure DNS record",
                reason: "dns_error",
            });
            return;
        }
        try {
            await connection_1.db.insert(schema_1.restaurantDomains).values({
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
        }
        catch (dbErr) {
            if (dbErr?.message?.includes("Duplicate") ||
                dbErr?.code === "ER_DUP_ENTRY") {
                res.status(409).json({
                    error: `Domain '${fullDomain}' already registered`,
                    reason: "taken",
                });
                return;
            }
            throw dbErr;
        }
        const inserted = await connection_1.db
            .select()
            .from(schema_1.restaurantDomains)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.domain, fullDomain))
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
    const domain = body.domain;
    // Duplicate check
    const existing = await connection_1.db
        .select({ id: schema_1.restaurantDomains.id })
        .from(schema_1.restaurantDomains)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.domain, domain))
        .limit(1);
    if (existing.length)
        throw new Errors_1.ConflictError("Domain already registered");
    const apex = (0, pleskClient_1.isApexDomain)(domain) ? 1 : 0;
    if (source === "external") {
        const token = crypto_1.default.randomBytes(32).toString("hex");
        await connection_1.db.insert(schema_1.restaurantDomains).values({
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
        const inserted = await connection_1.db
            .select()
            .from(schema_1.restaurantDomains)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.domain, domain))
            .limit(1);
        const mainDomain = MAIN_DOMAIN();
        const dnsRecords = apex === 0
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
        const note = apex === 1
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
    await connection_1.db.insert(schema_1.restaurantDomains).values({
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
    const inserted = await connection_1.db
        .select()
        .from(schema_1.restaurantDomains)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.domain, domain))
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
exports.addDomain = addDomain;
// --------------------------------------------------------------------------
// POST /api/superadmin/domains/:domainId/verify
// --------------------------------------------------------------------------
const verifyDomain = async (req, res) => {
    const domainId = parseInt(req.params.domainId, 10);
    if (isNaN(domainId))
        throw new Errors_1.BadRequest("Invalid domain ID");
    const rows = await connection_1.db
        .select()
        .from(schema_1.restaurantDomains)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, domainId))
        .limit(1);
    if (!rows.length)
        throw new Errors_1.NotFound("Domain not found");
    const record = rows[0];
    if (record.source !== "external") {
        throw new Errors_1.BadRequest("Only external domains require TXT verification");
    }
    if (record.verified === 1) {
        res.status(200).json({ verified: true, pointsToServer: true, alreadyVerified: true });
        return;
    }
    if (!record.verificationToken) {
        throw new Errors_1.AppError("Domain has no verification token", 422);
    }
    const expectedValue = `keeto-verification=${record.verificationToken}`;
    const lookupHost = `_keeto-verify.${record.domain}`;
    let verified = false;
    try {
        const txtRecords = await dns_1.default.promises.resolveTxt(lookupHost);
        verified = txtRecords.some((chunks) => chunks.join("").includes(expectedValue));
    }
    catch (err) {
        if (!["ENOTFOUND", "ENODATA", "ENOENT"].includes(err.code)) {
            console.error("[verifyDomain] DNS error:", err);
        }
    }
    if (!verified) {
        res.status(400).json({ verified: false });
        return;
    }
    // Mark verified
    await connection_1.db
        .update(schema_1.restaurantDomains)
        .set({
        verified: 1,
        provisionStatus: pleskEnabled() ? "running" : "idle",
    })
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, domainId));
    domainCache_1.domainResolutionCache.delete(record.domain);
    if (pleskEnabled()) {
        startBackgroundProvisioning(domainId, record.domain, "external", record.provisionStep);
    }
    const pts = await (0, pleskClient_1.pointsToServer)(record.domain).catch(() => false);
    res.status(200).json({
        verified: true,
        pointsToServer: pts,
        provisioningStarted: pleskEnabled(),
    });
};
exports.verifyDomain = verifyDomain;
// --------------------------------------------------------------------------
// POST /api/superadmin/domains/:domainId/provision  (manual retry)
// --------------------------------------------------------------------------
const retryProvisioning = async (req, res) => {
    const domainId = parseInt(req.params.domainId, 10);
    if (isNaN(domainId))
        throw new Errors_1.BadRequest("Invalid domain ID");
    const rows = await connection_1.db
        .select()
        .from(schema_1.restaurantDomains)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, domainId))
        .limit(1);
    if (!rows.length)
        throw new Errors_1.NotFound("Domain not found");
    const record = rows[0];
    if (record.verified !== 1) {
        throw new Errors_1.BadRequest("Domain must be verified before provisioning");
    }
    if (!pleskEnabled()) {
        throw new Errors_1.BadRequest("ENABLE_PLESK_PROVISIONING is disabled. Enable it in env to run provisioning.");
    }
    // Return 409 if provisioning is already running for this domain
    if ((0, pleskClient_1.isProvisionLocked)(domainId)) {
        res.status(409).json({
            error: "Provisioning is already running for this domain",
            provision_status: "running",
        });
        return;
    }
    // Also check DB: if status is 'running' and started recently (within PROVISION_RETRY_MINUTES)
    if (record.provisionStatus === "running" && record.provisionStartedAt) {
        const retryMinutes = parseInt(process.env.PROVISION_RETRY_MINUTES ?? "10", 10);
        const elapsed = (Date.now() - new Date(record.provisionStartedAt).getTime()) / 60000;
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
    startBackgroundProvisioning(domainId, record.domain, record.source, record.provisionStep);
    res.status(202).json({
        provision_status: "running",
        domain: record.domain,
        message: "Provisioning started in background",
    });
};
exports.retryProvisioning = retryProvisioning;
// --------------------------------------------------------------------------
// DELETE /api/superadmin/domains/:domainId
// --------------------------------------------------------------------------
const deleteDomain = async (req, res) => {
    const domainId = parseInt(req.params.domainId, 10);
    if (isNaN(domainId))
        throw new Errors_1.BadRequest("Invalid domain ID");
    const rows = await connection_1.db
        .select()
        .from(schema_1.restaurantDomains)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, domainId))
        .limit(1);
    if (!rows.length)
        throw new Errors_1.NotFound("Domain not found");
    const record = rows[0];
    // Delete from DB first (FK cascade handles related data)
    await connection_1.db
        .delete(schema_1.restaurantDomains)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, domainId));
    // Evict from cache immediately
    domainCache_1.domainResolutionCache.delete(record.domain);
    // Remove from Plesk if provisioning enabled (non-blocking)
    if (pleskEnabled()) {
        (0, pleskClient_1.deletePleskDomain)(record.domain, record.pleskSiteCreated ?? 0).catch((err) => console.error("[Plesk] deletePleskDomain error:", err?.message));
    }
    // If source was 'subdomain', return a note with the DNS record admin should remove
    if (record.source === "subdomain") {
        (0, response_1.SuccessResponse)(res, {
            deleted: true,
            domain: record.domain,
            note: `DNS records were not removed automatically. Please remove the A record for '${record.domain}' from '${ROOT_ZONE()}' if no longer needed.`,
        });
        return;
    }
    (0, response_1.SuccessResponse)(res, { deleted: true, domain: record.domain });
};
exports.deleteDomain = deleteDomain;
// --------------------------------------------------------------------------
// POST /api/superadmin/domains/:domainId/set-order-link
// --------------------------------------------------------------------------
const setOrderLink = async (req, res) => {
    const domainId = parseInt(req.params.domainId, 10);
    if (isNaN(domainId))
        throw new Errors_1.BadRequest("Invalid domain ID");
    const rows = await connection_1.db
        .select()
        .from(schema_1.restaurantDomains)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantDomains.id, domainId))
        .limit(1);
    if (!rows.length)
        throw new Errors_1.NotFound("Domain not found");
    const record = rows[0];
    if (record.verified !== 1) {
        throw new Errors_1.BadRequest("Domain must be verified first");
    }
    if (record.sslStatus !== "active") {
        throw new Errors_1.BadRequest("SSL must be active before setting as order link");
    }
    await connection_1.db
        .update(schema_1.restaurants)
        .set({ orderLink: `https://${record.domain}` })
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, record.restaurantId));
    (0, response_1.SuccessResponse)(res, {
        restaurantId: record.restaurantId,
        orderLink: `https://${record.domain}`,
    });
};
exports.setOrderLink = setOrderLink;
