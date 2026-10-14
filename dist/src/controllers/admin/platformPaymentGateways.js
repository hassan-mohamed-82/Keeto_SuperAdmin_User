"use strict";
// src/controllers/admin/platformPaymentGateways.ts
// Super Admin CRUD for platform-level payment gateways.
// Keys are stored encrypted in `platform_payment_gateways` table (never in .env).
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActivePlatformGateway = exports.activatePlatformGateway = exports.deletePlatformGateway = exports.updatePlatformGateway = exports.createPlatformGateway = exports.getPlatformGateway = exports.listPlatformGateways = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const encryption_1 = require("../../utils/encryption");
const response_1 = require("../../utils/response");
// ─────────────────────────────────────────────────────────
// Sensitive fields that must be encrypted at rest
// ─────────────────────────────────────────────────────────
const SENSITIVE_FIELDS = ["apiKey", "secretKey", "hmac", "apiPassword"];
// ─────────────────────────────────────────────────────────
// Sanitise: mask sensitive fields before returning to client
// ─────────────────────────────────────────────────────────
function sanitize(record) {
    if (!record)
        return null;
    let creds = record.credentials;
    if (typeof creds === "string") {
        try {
            creds = JSON.parse(creds);
        }
        catch {
            creds = {};
        }
    }
    const safe = creds && typeof creds === "object" ? { ...creds } : {};
    for (const f of SENSITIVE_FIELDS) {
        if (safe[f])
            safe[f] = "******";
    }
    return { ...record, credentials: safe };
}
// ─────────────────────────────────────────────────────────
// Encrypt incoming sensitive fields
// ─────────────────────────────────────────────────────────
function encryptCredentials(raw) {
    const encrypted = { ...raw };
    for (const f of SENSITIVE_FIELDS) {
        if (encrypted[f] && !String(encrypted[f]).startsWith("******")) {
            encrypted[f] = (0, encryption_1.encryptSecret)(String(encrypted[f]));
        }
    }
    return encrypted;
}
// ─────────────────────────────────────────────────────────
// Merge update credentials — keep existing encrypted values
// for any field sent as "******" (not changed by the admin).
// ─────────────────────────────────────────────────────────
function mergeCredentials(existing, incoming) {
    const merged = { ...existing };
    // Copy non-sensitive fields freely
    for (const [k, v] of Object.entries(incoming)) {
        if (!SENSITIVE_FIELDS.includes(k)) {
            if (v !== undefined && v !== null && v !== "") {
                merged[k] = v;
            }
        }
    }
    // For sensitive fields: only overwrite when a real new value is provided
    for (const f of SENSITIVE_FIELDS) {
        const newVal = incoming[f];
        if (typeof newVal === "string" && newVal.trim() && !newVal.startsWith("******")) {
            merged[f] = (0, encryption_1.encryptSecret)(newVal.trim());
        }
        // Otherwise keep existing[f] as-is (already encrypted)
    }
    return merged;
}
// ═══════════════════════════════════════════════════════════
// 1. GET /admin/platform-gateways  — list all
// ═══════════════════════════════════════════════════════════
const listPlatformGateways = async (_req, res) => {
    const rows = await connection_1.db.select().from(schema_1.platformPaymentGateways);
    (0, response_1.SuccessResponse)(res, {
        message: "Platform gateways fetched successfully",
        data: rows.map(sanitize),
    });
};
exports.listPlatformGateways = listPlatformGateways;
// ═══════════════════════════════════════════════════════════
// 2. GET /admin/platform-gateways/:id  — get one
// ═══════════════════════════════════════════════════════════
const getPlatformGateway = async (req, res) => {
    const { id } = req.params;
    const [row] = await connection_1.db
        .select()
        .from(schema_1.platformPaymentGateways)
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.id, id))
        .limit(1);
    if (!row)
        throw new NotFound_1.NotFound("Platform gateway not found");
    (0, response_1.SuccessResponse)(res, {
        message: "Platform gateway fetched successfully",
        data: sanitize(row),
    });
};
exports.getPlatformGateway = getPlatformGateway;
// ═══════════════════════════════════════════════════════════
// 3. POST /admin/platform-gateways  — create
// ═══════════════════════════════════════════════════════════
const createPlatformGateway = async (req, res) => {
    const { title, provider, environment, credentials, logoUrl, isActive } = req.body;
    if (!credentials)
        throw new BadRequest_1.BadRequest("credentials are required");
    const rawCreds = typeof credentials === "string" ? JSON.parse(credentials) : credentials;
    const encryptedCreds = encryptCredentials(rawCreds);
    // If this gateway is being set as active, deactivate all others first
    if (isActive) {
        await connection_1.db
            .update(schema_1.platformPaymentGateways)
            .set({ isActive: false });
    }
    const newId = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.platformPaymentGateways).values({
        id: newId,
        title,
        provider: String(provider).toUpperCase(),
        environment: environment || "LIVE",
        credentials: encryptedCreds,
        logoUrl: logoUrl || null,
        isActive: isActive ?? false,
    });
    const [created] = await connection_1.db
        .select()
        .from(schema_1.platformPaymentGateways)
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.id, newId))
        .limit(1);
    res.status(201).json({
        success: true,
        message: "Platform gateway created successfully",
        data: sanitize(created),
    });
};
exports.createPlatformGateway = createPlatformGateway;
// ═══════════════════════════════════════════════════════════
// 4. PUT /admin/platform-gateways/:id  — update
// ═══════════════════════════════════════════════════════════
const updatePlatformGateway = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.platformPaymentGateways)
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.id, id))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Platform gateway not found");
    const { title, provider, environment, credentials, logoUrl, isActive } = req.body;
    const updatePayload = {};
    if (title !== undefined)
        updatePayload.title = title;
    if (provider !== undefined)
        updatePayload.provider = String(provider).toUpperCase();
    if (environment !== undefined)
        updatePayload.environment = environment;
    if (logoUrl !== undefined)
        updatePayload.logoUrl = logoUrl || null;
    if (credentials !== undefined) {
        let incomingCreds = typeof credentials === "string" ? JSON.parse(credentials) : credentials;
        let existingCreds = existing.credentials;
        if (typeof existingCreds === "string") {
            try {
                existingCreds = JSON.parse(existingCreds);
            }
            catch {
                existingCreds = {};
            }
        }
        updatePayload.credentials = mergeCredentials(existingCreds || {}, incomingCreds || {});
    }
    if (isActive !== undefined) {
        if (isActive === true) {
            // Deactivate all other gateways before activating this one
            await connection_1.db
                .update(schema_1.platformPaymentGateways)
                .set({ isActive: false });
        }
        updatePayload.isActive = isActive;
    }
    if (Object.keys(updatePayload).length > 0) {
        await connection_1.db
            .update(schema_1.platformPaymentGateways)
            .set(updatePayload)
            .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.id, id));
    }
    const [updated] = await connection_1.db
        .select()
        .from(schema_1.platformPaymentGateways)
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.id, id))
        .limit(1);
    (0, response_1.SuccessResponse)(res, {
        message: "Platform gateway updated successfully",
        data: sanitize(updated),
    });
};
exports.updatePlatformGateway = updatePlatformGateway;
// ═══════════════════════════════════════════════════════════
// 5. DELETE /admin/platform-gateways/:id
// ═══════════════════════════════════════════════════════════
const deletePlatformGateway = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select({ id: schema_1.platformPaymentGateways.id })
        .from(schema_1.platformPaymentGateways)
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.id, id))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Platform gateway not found");
    await connection_1.db.delete(schema_1.platformPaymentGateways).where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.id, id));
    (0, response_1.SuccessResponse)(res, { message: "Platform gateway deleted successfully" });
};
exports.deletePlatformGateway = deletePlatformGateway;
// ═══════════════════════════════════════════════════════════
// 6. PUT /admin/platform-gateways/:id/activate
//    Activates a gateway and deactivates all others.
// ═══════════════════════════════════════════════════════════
const activatePlatformGateway = async (req, res) => {
    const { id } = req.params;
    const [existing] = await connection_1.db
        .select({ id: schema_1.platformPaymentGateways.id })
        .from(schema_1.platformPaymentGateways)
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.id, id))
        .limit(1);
    if (!existing)
        throw new NotFound_1.NotFound("Platform gateway not found");
    // Deactivate all, then activate the selected one
    await connection_1.db.update(schema_1.platformPaymentGateways).set({ isActive: false });
    await connection_1.db
        .update(schema_1.platformPaymentGateways)
        .set({ isActive: true })
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.id, id));
    (0, response_1.SuccessResponse)(res, {
        message: "Platform gateway activated successfully. All other gateways have been deactivated.",
    });
};
exports.activatePlatformGateway = activatePlatformGateway;
// ═══════════════════════════════════════════════════════════
// 7. GET /admin/platform-gateways/active  — get currently active gateway (for inspection)
// ═══════════════════════════════════════════════════════════
const getActivePlatformGateway = async (_req, res) => {
    const [row] = await connection_1.db
        .select()
        .from(schema_1.platformPaymentGateways)
        .where((0, drizzle_orm_1.eq)(schema_1.platformPaymentGateways.isActive, true))
        .limit(1);
    (0, response_1.SuccessResponse)(res, {
        message: row ? "Active platform gateway fetched" : "No active platform gateway configured",
        data: row ? sanitize(row) : null,
    });
};
exports.getActivePlatformGateway = getActivePlatformGateway;
