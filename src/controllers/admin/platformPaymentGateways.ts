import { Request, Response } from "express";
import { db } from "../../models/connection";
import { platformPaymentGateways } from "../../models/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { encryptSecret } from "../../utils/encryption";
import { SuccessResponse } from "../../utils/response";

// ─────────────────────────────────────────────────────────
// Sensitive fields that must be encrypted at rest
// ─────────────────────────────────────────────────────────
const SENSITIVE_FIELDS = ["apiKey", "secretKey", "hmac", "apiPassword"] as const;

// ─────────────────────────────────────────────────────────
// Sanitise: mask sensitive fields before returning to client
// ─────────────────────────────────────────────────────────
function sanitize(record: any) {
    if (!record) return null;

    let creds: any = record.credentials;
    if (typeof creds === "string") {
        try { creds = JSON.parse(creds); } catch { creds = {}; }
    }
    const safe = creds && typeof creds === "object" ? { ...creds } : {};
    for (const f of SENSITIVE_FIELDS) {
        if (safe[f]) safe[f] = "******";
    }
    return {
        ...record,
        credentials: safe,
        isDefault: Boolean(record.isDefault),
    };
}

// ─────────────────────────────────────────────────────────
// Encrypt incoming sensitive fields
// ─────────────────────────────────────────────────────────
function encryptCredentials(raw: Record<string, any>): Record<string, any> {
    const encrypted = { ...raw };
    for (const f of SENSITIVE_FIELDS) {
        if (encrypted[f] && !String(encrypted[f]).startsWith("******")) {
            encrypted[f] = encryptSecret(String(encrypted[f]));
        }
    }
    return encrypted;
}

// ─────────────────────────────────────────────────────────
// Validate that a logo value is a proper base64 data URI.
// Plain URLs (http/https) are rejected — only data URIs are accepted.
// ─────────────────────────────────────────────────────────
function validateLogoBase64(value: string): void {
    if (!value) return;
    const base64DataUriPattern = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
    if (!base64DataUriPattern.test(value)) {
        throw new BadRequest(
            "logoUrl must be a valid base64 image data URI (e.g. \"data:image/png;base64,...\"). Plain URLs are not accepted."
        );
    }
}

// ─────────────────────────────────────────────────────────
// Merge update credentials — keep existing encrypted values
// for any field sent as "******" (not changed by the admin).
// ─────────────────────────────────────────────────────────
function mergeCredentials(
    existing: Record<string, any>,
    incoming: Record<string, any>
): Record<string, any> {
    const merged: Record<string, any> = { ...existing };

    // Copy non-sensitive fields freely
    for (const [k, v] of Object.entries(incoming)) {
        if (!(SENSITIVE_FIELDS as readonly string[]).includes(k)) {
            if (v !== undefined && v !== null && v !== "") {
                merged[k] = v;
            }
        }
    }

    // For sensitive fields: only overwrite when a real new value is provided
    for (const f of SENSITIVE_FIELDS) {
        const newVal = incoming[f];
        if (typeof newVal === "string" && newVal.trim() && !newVal.startsWith("******")) {
            merged[f] = encryptSecret(newVal.trim());
        }
        // Otherwise keep existing[f] as-is (already encrypted)
    }

    return merged;
}

// ═══════════════════════════════════════════════════════════
// 1. GET /admin/platform-gateways  — list all
// ═══════════════════════════════════════════════════════════
export const listPlatformGateways = async (_req: Request, res: Response): Promise<void> => {
    const rows = await db.select().from(platformPaymentGateways);
    SuccessResponse(res, {
        message: "Platform gateways fetched successfully",
        data: rows.map(sanitize),
    });
};

// ═══════════════════════════════════════════════════════════
// 2. GET /admin/platform-gateways/:id  — get one
// ═══════════════════════════════════════════════════════════
export const getPlatformGateway = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const [row] = await db
        .select()
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.id, id))
        .limit(1);

    if (!row) throw new NotFound("Platform gateway not found");

    SuccessResponse(res, {
        message: "Platform gateway fetched successfully",
        data: sanitize(row),
    });
};

// ═══════════════════════════════════════════════════════════
// 3. POST /admin/platform-gateways  — create
// ═══════════════════════════════════════════════════════════
export const createPlatformGateway = async (req: Request, res: Response): Promise<void> => {
    const { title, provider, environment, credentials, logoUrl, isActive } = req.body;

    if (!credentials) throw new BadRequest("credentials are required");

    let rawCreds = credentials;
    if (typeof credentials === "string") {
        try {
            rawCreds = JSON.parse(credentials);
        } catch {
            throw new BadRequest("Invalid JSON format in credentials");
        }
    }

    const encryptedCreds = encryptCredentials(rawCreds);

    // Validate logo is base64 (not a URL)
    if (logoUrl) validateLogoBase64(logoUrl);

    // If this gateway is being set as active, deactivate all others first
    if (isActive) {
        await db
            .update(platformPaymentGateways)
            .set({ isActive: false });
    }

    const isDefaultInput = req.body.isDefault !== undefined ? req.body.isDefault : (req.body.default !== undefined ? req.body.default : req.body.defualt);
    let resolvedIsDefault = isDefaultInput !== undefined ? Boolean(isDefaultInput) : false;
    const existingGateways = await db.select({ id: platformPaymentGateways.id }).from(platformPaymentGateways).limit(1);
    if (existingGateways.length === 0) {
        resolvedIsDefault = true;
    }
    if (resolvedIsDefault) {
        await db.update(platformPaymentGateways).set({ isDefault: false });
    }

    const newId = uuidv4();
    await db.insert(platformPaymentGateways).values({
        id: newId,
        title,
        provider: String(provider).toUpperCase() as "PAYMOB" | "KASHIER" | "GEIDEA",
        environment: environment || "LIVE",
        credentials: encryptedCreds,
        logoUrl: logoUrl || null,
        isActive: isActive ?? false,
        isDefault: resolvedIsDefault,
    });

    const [created] = await db
        .select()
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.id, newId))
        .limit(1);

    SuccessResponse(res, {
        message: "Platform gateway created successfully",
        data: sanitize(created),
    });
};

// ═══════════════════════════════════════════════════════════
// 4. PUT /admin/platform-gateways/:id  — update
// ═══════════════════════════════════════════════════════════
export const updatePlatformGateway = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const [existing] = await db
        .select()
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.id, id))
        .limit(1);

    if (!existing) throw new NotFound("Platform gateway not found");

    const { title, provider, environment, credentials, logoUrl, isActive } = req.body;

    const updatePayload: Record<string, any> = {};
    if (title !== undefined) updatePayload.title = title;
    if (provider !== undefined) updatePayload.provider = String(provider).toUpperCase();
    if (environment !== undefined) updatePayload.environment = environment;
    if (logoUrl !== undefined) {
        if (logoUrl) validateLogoBase64(logoUrl);
        updatePayload.logoUrl = logoUrl || null;
    }

    if (credentials !== undefined) {
        let incomingCreds = credentials;
        if (typeof credentials === "string") {
            try { incomingCreds = JSON.parse(credentials); } catch { incomingCreds = {}; }
        }

        let existingCreds: any = existing.credentials;
        if (typeof existingCreds === "string") {
            try { existingCreds = JSON.parse(existingCreds); } catch { existingCreds = {}; }
        }
        updatePayload.credentials = mergeCredentials(existingCreds || {}, incomingCreds || {});
    }

    if (isActive !== undefined) {
        if (isActive === true) {
            // Deactivate all other gateways before activating this one
            await db
                .update(platformPaymentGateways)
                .set({ isActive: false });
        }
        updatePayload.isActive = isActive;
    }
    const isDefaultInput = req.body.isDefault !== undefined ? req.body.isDefault : (req.body.default !== undefined ? req.body.default : req.body.defualt);
    if (isDefaultInput !== undefined) {
        const isDefaultVal = Boolean(isDefaultInput);
        if (isDefaultVal) {
            await db.update(platformPaymentGateways).set({ isDefault: false });
        }
        updatePayload.isDefault = isDefaultVal;
    }

    if (Object.keys(updatePayload).length > 0) {
        await db
            .update(platformPaymentGateways)
            .set(updatePayload)
            .where(eq(platformPaymentGateways.id, id));
    }

    const [updated] = await db
        .select()
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.id, id))
        .limit(1);

    SuccessResponse(res, {
        message: "Platform gateway updated successfully",
        data: sanitize(updated),
    });
};

// ═══════════════════════════════════════════════════════════
// 5. DELETE /admin/platform-gateways/:id
// ═══════════════════════════════════════════════════════════
export const deletePlatformGateway = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const [existing] = await db
        .select({ id: platformPaymentGateways.id })
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.id, id))
        .limit(1);

    if (!existing) throw new NotFound("Platform gateway not found");

    await db.delete(platformPaymentGateways).where(eq(platformPaymentGateways.id, id));

    SuccessResponse(res, { message: "Platform gateway deleted successfully" });
};

// ═══════════════════════════════════════════════════════════
// 6. PUT /admin/platform-gateways/:id/activate
//    Activates a gateway and deactivates all others.
// ═══════════════════════════════════════════════════════════
export const activatePlatformGateway = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const [existing] = await db
        .select({ id: platformPaymentGateways.id })
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.id, id))
        .limit(1);

    if (!existing) throw new NotFound("Platform gateway not found");

    // Deactivate all, then activate the selected one
    await db.update(platformPaymentGateways).set({ isActive: false });
    await db
        .update(platformPaymentGateways)
        .set({ isActive: true })
        .where(eq(platformPaymentGateways.id, id));

    SuccessResponse(res, {
        message: "Platform gateway activated successfully. All other gateways have been deactivated.",
    });
};

// ═══════════════════════════════════════════════════════════
// 7. GET /admin/platform-gateways/active  — get currently active gateway (for inspection)
// ═══════════════════════════════════════════════════════════
export const getActivePlatformGateway = async (_req: Request, res: Response): Promise<void> => {
    const [row] = await db
        .select()
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.isActive, true))
        .limit(1);

    SuccessResponse(res, {
        message: row ? "Active platform gateway fetched" : "No active platform gateway configured",
        data: row ? sanitize(row) : null,
    });
};

// ═══════════════════════════════════════════════════════════
// 8. PUT /admin/platform-gateways/:id/default
//    Sets a gateway as the single default platform gateway.
// ═══════════════════════════════════════════════════════════
export const setDefaultPlatformGateway = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const [existing] = await db
        .select({ id: platformPaymentGateways.id })
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.id, id))
        .limit(1);

    if (!existing) throw new NotFound("Platform gateway not found");

    // Remove default from all gateways first
    await db.update(platformPaymentGateways).set({ isDefault: false });

    // Mark selected one as default
    await db
        .update(platformPaymentGateways)
        .set({ isDefault: true })
        .where(eq(platformPaymentGateways.id, id));

    const [updated] = await db
        .select()
        .from(platformPaymentGateways)
        .where(eq(platformPaymentGateways.id, id))
        .limit(1);

    SuccessResponse(res, {
        message: "Platform gateway set as default successfully. All other platform gateways have been unset as default.",
        data: sanitize(updated),
    });
};
