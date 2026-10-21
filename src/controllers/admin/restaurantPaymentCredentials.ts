import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantPaymentCredentials, restaurantSettings, restaurantWallets, restaurants } from "../../models/schema";
import { eq, and, ne } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { encryptSecret } from "../../utils/encryption";
import { SuccessResponse } from "../../utils/response";
import { restoreCustomGatewayOnDebtSettled } from "../../services/restaurantWalletService";

// Helper to sanitize credential secrets before sending in response
const sanitizeCredentialRecord = (record: any) => {
    if (!record) return null;
    let creds: any = record.credentials;
    if (typeof creds === "string") {
        try {
            creds = JSON.parse(creds);
        } catch {
            creds = {};
        }
    }
    // Auto-heal if previously corrupted with character-spread keys: { 0: '{', 1: '"', ... }
    if (creds && typeof creds === "object" && "0" in creds && !("mid" in creds) && !("apiKey" in creds)) {
        try {
            const reconstructed = Object.keys(creds)
                .sort((a, b) => Number(a) - Number(b))
                .map((k) => creds[k])
                .join("");
            creds = JSON.parse(reconstructed);
        } catch {}
    }
    const safeCreds = creds && typeof creds === "object" ? { ...creds } : {};
    if (safeCreds.apiKey) safeCreds.apiKey = "******";
    if (safeCreds.hmac) safeCreds.hmac = "******";
    if (safeCreds.secretKey) safeCreds.secretKey = "******";
    if (safeCreds.apiPassword) safeCreds.apiPassword = "******";
    return {
        ...record,
        credentials: safeCreds,
        isDefault: Boolean(record.isDefault),
        default: Boolean(record.isDefault),
    };
};

/**
 * 1. Add/Create Payment Credentials for a restaurant
 */
export const createCredentials = async (req: Request, res: Response): Promise<void> => {
    const restaurantId = req.params.restaurantId;
    if (!restaurantId) {
        throw new BadRequest("Restaurant ID is required");
    }

    const [restaurantExists] = await db
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

    if (!restaurantExists) {
        throw new NotFound("Restaurant not found");
    }

    const { provider, title, environment, credentials, percentageValue, fixedValue, tax, logoUrl, isActive } = req.body;

    if (!provider || !credentials) {
        throw new BadRequest("Provider and credentials are required");
    }

    const rawCreds = typeof credentials === "string" ? JSON.parse(credentials) : credentials;

    // Encrypt sensitive credential fields before storing in database
    const encryptedCredentials: Record<string, any> = { ...rawCreds };
    if (rawCreds.apiKey && !rawCreds.apiKey.startsWith("******")) {
        encryptedCredentials.apiKey = encryptSecret(rawCreds.apiKey);
    }
    if (rawCreds.hmac && !rawCreds.hmac.startsWith("******")) {
        encryptedCredentials.hmac = encryptSecret(rawCreds.hmac);
    }
    if (rawCreds.secretKey && !rawCreds.secretKey.startsWith("******")) {
        encryptedCredentials.secretKey = encryptSecret(rawCreds.secretKey);
    }
    if (rawCreds.apiPassword && !rawCreds.apiPassword.startsWith("******")) {
        encryptedCredentials.apiPassword = encryptSecret(rawCreds.apiPassword);
    }

    const newId = uuidv4();
    const formattedProvider = String(provider).toUpperCase() as "PAYMOB" | "KASHIER" | "GEIDEA";

    // Resolve isDefault — accept both "isDefault", "default", and typo "defualt"
    const isDefaultInput = req.body.isDefault !== undefined
        ? req.body.isDefault
        : req.body.default !== undefined
        ? req.body.default
        : req.body.defualt;

    // If this is the first credential for this restaurant, it becomes default automatically
    const [existingCount] = await db
        .select({ id: restaurantPaymentCredentials.id })
        .from(restaurantPaymentCredentials)
        .where(eq(restaurantPaymentCredentials.restaurantId, restaurantId))
        .limit(1);

    const resolvedIsDefault = isDefaultInput !== undefined ? Boolean(isDefaultInput) : !existingCount;
    const resolvedIsActive = isActive !== undefined ? Boolean(isActive) : true;

    // Enforce SINGLE default per restaurant
    if (resolvedIsDefault) {
        await db
            .update(restaurantPaymentCredentials)
            .set({ isDefault: false })
            .where(eq(restaurantPaymentCredentials.restaurantId, restaurantId));
    }

    // Enforce SINGLE active credential per restaurant
    if (resolvedIsActive) {
        await db
            .update(restaurantPaymentCredentials)
            .set({ isActive: false })
            .where(eq(restaurantPaymentCredentials.restaurantId, restaurantId));
    }

    await db.insert(restaurantPaymentCredentials).values({
        id: newId,
        restaurantId,
        provider: formattedProvider,
        title: title || formattedProvider,
        environment: environment || "LIVE",
        credentials: encryptedCredentials,
        percentageValue: percentageValue !== undefined ? String(parseFloat(percentageValue || "0").toFixed(2)) : "0.00",
        fixedValue: fixedValue !== undefined ? String(parseFloat(fixedValue || "0").toFixed(2)) : "0.00",
        tax: tax !== undefined ? String(parseFloat(tax || "0").toFixed(2)) : "0.00",
        logoUrl: logoUrl || null,
        isActive: resolvedIsActive,
        isDefault: resolvedIsDefault,
    });

    const [created] = await db
        .select()
        .from(restaurantPaymentCredentials)
        .where(eq(restaurantPaymentCredentials.id, newId))
        .limit(1);

    // 👈 لو هذي أول credentials للمطعم (مفيش كانت عنده credentials قبل)
    // والمطعم حالياً على SYSTEM بدون visa switch سبق تطبيقه
    // ورصيده إيجابي (>= 0) → حوله لـ CUSTOM تلقائياً
    if (!existingCount) {
        try {
            const [currentSettings] = await db
                .select({
                    paymentGatewayType: restaurantSettings.paymentGatewayType,
                    visaSwitchApplied: restaurantSettings.visaSwitchApplied,
                    visaSwitchConditionType: restaurantSettings.visaSwitchConditionType,
                })
                .from(restaurantSettings)
                .where(eq(restaurantSettings.restaurantId, restaurantId))
                .limit(1);

            const isOnSystemWithNoSwitch =
                currentSettings?.paymentGatewayType === "SYSTEM" &&
                currentSettings?.visaSwitchApplied !== true;

            if (isOnSystemWithNoSwitch) {
                const [wallet] = await db
                    .select({ balance: restaurantWallets.balance })
                    .from(restaurantWallets)
                    .where(eq(restaurantWallets.restaurantId, restaurantId))
                    .limit(1);

                const currentBalance = parseFloat(String(wallet?.balance ?? "0"));

                // لو الرصيد إيجابي → المطعم مش مديون للمنصة، حوله لـ CUSTOM
                if (currentBalance >= 0) {
                    await restoreCustomGatewayOnDebtSettled(db, restaurantId, currentBalance);
                }
            }
        } catch (err) {
            console.error("[createCredentials] Failed to auto-switch to CUSTOM:", err);
        }
    }

    res.status(201).json({
        success: true,
        message: "Payment credentials created successfully",
        data: sanitizeCredentialRecord(created),
    });
};

/**
 * 2. Get all payment credentials for a restaurant
 */
export const getCredentialsByRestaurant = async (req: Request, res: Response): Promise<void> => {
    const restaurantId = req.params.restaurantId;
    if (!restaurantId) {
        throw new BadRequest("Restaurant ID is required");
    }

    const list = await db
        .select()
        .from(restaurantPaymentCredentials)
        .where(eq(restaurantPaymentCredentials.restaurantId, restaurantId));

    const sanitizedList = list.map(sanitizeCredentialRecord);

    res.status(200).json({
        success: true,
        data: sanitizedList,
    });
};

/**
 * 3. Update a specific payment credential
 */
export const updateCredential = async (req: Request, res: Response): Promise<void> => {
    const { restaurantId, credentialId } = req.params;
    if (!restaurantId || !credentialId) {
        throw new BadRequest("Restaurant ID and Credential ID are required");
    }

    const [existing] = await db
        .select()
        .from(restaurantPaymentCredentials)
        .where(
            and(
                eq(restaurantPaymentCredentials.id, credentialId),
                eq(restaurantPaymentCredentials.restaurantId, restaurantId)
            )
        )
        .limit(1);

    if (!existing) {
        throw new NotFound("Payment credentials record not found");
    }

    const { provider, title, environment, credentials, percentageValue, fixedValue, tax, logoUrl, isActive } = req.body;

    const updatePayload: Record<string, any> = {};
    if (provider !== undefined) updatePayload.provider = String(provider).toUpperCase() as "PAYMOB" | "KASHIER" | "GEIDEA";
    if (title !== undefined) updatePayload.title = title;
    if (environment !== undefined) updatePayload.environment = environment;
    if (percentageValue !== undefined) updatePayload.percentageValue = String(parseFloat(percentageValue || "0").toFixed(2));
    if (fixedValue !== undefined) updatePayload.fixedValue = String(parseFloat(fixedValue || "0").toFixed(2));
    if (tax !== undefined) updatePayload.tax = String(parseFloat(tax || "0").toFixed(2));
    if (logoUrl !== undefined) updatePayload.logoUrl = logoUrl || null;

    // Enforce SINGLE active credential per restaurant
    if (isActive !== undefined) {
        const isAct = Boolean(isActive);
        if (isAct) {
            await db
                .update(restaurantPaymentCredentials)
                .set({ isActive: false })
                .where(
                    and(
                        eq(restaurantPaymentCredentials.restaurantId, restaurantId),
                        ne(restaurantPaymentCredentials.id, credentialId)
                    )
                );
        }
        updatePayload.isActive = isAct;
    }

    // Handle isDefault — accept both "isDefault", "default", and typo "defualt"
    const isDefaultInput = req.body.isDefault !== undefined
        ? req.body.isDefault
        : req.body.default !== undefined
        ? req.body.default
        : req.body.defualt;

    if (isDefaultInput !== undefined) {
        const isDefaultVal = Boolean(isDefaultInput);
        if (isDefaultVal) {
            // Only ONE credential per restaurant can be default at a time
            await db
                .update(restaurantPaymentCredentials)
                .set({ isDefault: false })
                .where(eq(restaurantPaymentCredentials.restaurantId, restaurantId));
        }
        updatePayload.isDefault = isDefaultVal;
    }

    if (credentials !== undefined) {
        let rawCreds = credentials;
        if (typeof rawCreds === "string") {
            try { rawCreds = JSON.parse(rawCreds); } catch { rawCreds = {}; }
        }
        let existingCreds: any = existing.credentials;
        if (typeof existingCreds === "string") {
            try { existingCreds = JSON.parse(existingCreds); } catch { existingCreds = {}; }
        }
        if (existingCreds && typeof existingCreds === "object" && "0" in existingCreds && !("mid" in existingCreds) && !("apiKey" in existingCreds)) {
            try {
                const reconstructed = Object.keys(existingCreds)
                    .sort((a, b) => Number(a) - Number(b))
                    .map((k) => existingCreds[k])
                    .join("");
                existingCreds = JSON.parse(reconstructed);
            } catch {}
        }
        const sensitiveFields = ["apiKey", "hmac", "secretKey", "apiPassword"];
        const mergedCredentials: Record<string, any> = {
            ...(existingCreds && typeof existingCreds === "object" ? existingCreds : {}),
        };

        if (rawCreds && typeof rawCreds === "object") {
            for (const [k, v] of Object.entries(rawCreds)) {
                if (!sensitiveFields.includes(k) && v !== undefined && v !== null && v !== "") {
                    mergedCredentials[k] = v;
                }
            }
        }

        for (const field of sensitiveFields) {
            const incomingVal = rawCreds?.[field];
            if (typeof incomingVal === "string" && incomingVal.trim() !== "" && !incomingVal.startsWith("******")) {
                mergedCredentials[field] = encryptSecret(incomingVal.trim());
            } else if (existingCreds?.[field] !== undefined && existingCreds?.[field] !== null && existingCreds?.[field] !== "") {
                mergedCredentials[field] = existingCreds[field];
            }
        }

        updatePayload.credentials = mergedCredentials;
    }

    if (Object.keys(updatePayload).length > 0) {
        await db
            .update(restaurantPaymentCredentials)
            .set(updatePayload)
            .where(eq(restaurantPaymentCredentials.id, credentialId));
    }

    const [updated] = await db
        .select()
        .from(restaurantPaymentCredentials)
        .where(eq(restaurantPaymentCredentials.id, credentialId))
        .limit(1);

    res.status(200).json({
        success: true,
        message: "Payment credentials updated successfully",
        data: sanitizeCredentialRecord(updated),
    });
};

/**
 * 4. Delete payment credentials
 */
export const deleteCredential = async (req: Request, res: Response): Promise<void> => {
    const { restaurantId, credentialId } = req.params;
    if (!restaurantId || !credentialId) {
        throw new BadRequest("Restaurant ID and Credential ID are required");
    }

    const [existing] = await db
        .select({ id: restaurantPaymentCredentials.id, isDefault: restaurantPaymentCredentials.isDefault })
        .from(restaurantPaymentCredentials)
        .where(
            and(
                eq(restaurantPaymentCredentials.id, credentialId),
                eq(restaurantPaymentCredentials.restaurantId, restaurantId)
            )
        )
        .limit(1);

    if (!existing) {
        throw new NotFound("Payment credentials record not found");
    }

    await db
        .delete(restaurantPaymentCredentials)
        .where(eq(restaurantPaymentCredentials.id, credentialId));

    // If the deleted credential was the default, assign default to the next active credential (if any)
    if (existing.isDefault) {
        const [nextActive] = await db
            .select({ id: restaurantPaymentCredentials.id })
            .from(restaurantPaymentCredentials)
            .where(
                and(
                    eq(restaurantPaymentCredentials.restaurantId, restaurantId),
                    eq(restaurantPaymentCredentials.isActive, true)
                )
            )
            .limit(1);
        if (nextActive) {
            await db
                .update(restaurantPaymentCredentials)
                .set({ isDefault: true })
                .where(eq(restaurantPaymentCredentials.id, nextActive.id));
        }
    }

    res.status(200).json({
        success: true,
        message: "Payment credentials deleted successfully",
    });
};

/**
 * 5. Toggle active status of credentials
 *    Only ONE credential per restaurant can be active at a time.
 */
export const toggleCredential = async (req: Request, res: Response): Promise<void> => {
    const { restaurantId, credentialId } = req.params;
    const { isActive } = req.body;

    if (!restaurantId || !credentialId) {
        throw new BadRequest("Restaurant ID and Credential ID are required");
    }

    if (typeof isActive !== "boolean") {
        throw new BadRequest("isActive must be a boolean value");
    }

    const [existing] = await db
        .select({ id: restaurantPaymentCredentials.id, isDefault: restaurantPaymentCredentials.isDefault })
        .from(restaurantPaymentCredentials)
        .where(
            and(
                eq(restaurantPaymentCredentials.id, credentialId),
                eq(restaurantPaymentCredentials.restaurantId, restaurantId)
            )
        )
        .limit(1);

    if (!existing) {
        throw new NotFound("Payment credentials record not found");
    }

    // If setting to active, deactivate all other credentials for this restaurant
    if (isActive === true) {
        await db
            .update(restaurantPaymentCredentials)
            .set({ isActive: false })
            .where(
                and(
                    eq(restaurantPaymentCredentials.restaurantId, restaurantId),
                    ne(restaurantPaymentCredentials.id, credentialId)
                )
            );
    }

    await db
        .update(restaurantPaymentCredentials)
        .set({ isActive })
        .where(eq(restaurantPaymentCredentials.id, credentialId));

    res.status(200).json({
        success: true,
        message: `Payment credentials ${isActive ? "activated" : "deactivated"} successfully`,
    });
};

/**
 * 6. Set a specific credential as the default for a restaurant
 *    Only ONE credential per restaurant can be default at a time.
 */
export const setDefaultCredential = async (req: Request, res: Response): Promise<void> => {
    const { restaurantId, credentialId } = req.params;

    if (!restaurantId || !credentialId) {
        throw new BadRequest("Restaurant ID and Credential ID are required");
    }

    const [existing] = await db
        .select({ id: restaurantPaymentCredentials.id })
        .from(restaurantPaymentCredentials)
        .where(
            and(
                eq(restaurantPaymentCredentials.id, credentialId),
                eq(restaurantPaymentCredentials.restaurantId, restaurantId)
            )
        )
        .limit(1);

    if (!existing) {
        throw new NotFound("Payment credentials record not found");
    }

    // Remove default from all credentials for this restaurant
    await db
        .update(restaurantPaymentCredentials)
        .set({ isDefault: false })
        .where(eq(restaurantPaymentCredentials.restaurantId, restaurantId));

    // Set this one as default
    await db
        .update(restaurantPaymentCredentials)
        .set({ isDefault: true })
        .where(eq(restaurantPaymentCredentials.id, credentialId));

    const [updated] = await db
        .select()
        .from(restaurantPaymentCredentials)
        .where(eq(restaurantPaymentCredentials.id, credentialId))
        .limit(1);

    SuccessResponse(res, {
        message: "Payment credential set as default successfully. All other credentials for this restaurant have been unset as default.",
        data: sanitizeCredentialRecord(updated),
    });
};
