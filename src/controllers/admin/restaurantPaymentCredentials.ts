import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantPaymentCredentials, restaurants } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { encryptSecret } from "../../utils/encryption";

// Helper to sanitize credential secrets before sending in response
const sanitizeCredentialRecord = (record: any) => {
    if (!record) return null;
    const creds = record.credentials ? { ...record.credentials } : {};
    if (creds.apiKey) creds.apiKey = "******";
    if (creds.hmac) creds.hmac = "******";
    if (creds.secretKey) creds.secretKey = "******";
    return {
        ...record,
        credentials: creds,
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

    const { provider, title, environment, credentials, logoUrl, isActive } = req.body;

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

    const newId = uuidv4();
    const formattedProvider = String(provider).toUpperCase() as "PAYMOB" | "KASHIER";

    await db.insert(restaurantPaymentCredentials).values({
        id: newId,
        restaurantId,
        provider: formattedProvider,
        title: title || formattedProvider,
        environment: environment || "LIVE",
        credentials: encryptedCredentials,
        logoUrl: logoUrl || null,
        isActive: isActive !== undefined ? isActive : true,
    });

    const [created] = await db
        .select()
        .from(restaurantPaymentCredentials)
        .where(eq(restaurantPaymentCredentials.id, newId))
        .limit(1);

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

    const { provider, title, environment, credentials, logoUrl, isActive } = req.body;

    const updatePayload: Record<string, any> = {};
    if (provider !== undefined) updatePayload.provider = String(provider).toUpperCase() as "PAYMOB" | "KASHIER";
    if (title !== undefined) updatePayload.title = title;
    if (environment !== undefined) updatePayload.environment = environment;
    if (logoUrl !== undefined) updatePayload.logoUrl = logoUrl || null;
    if (isActive !== undefined) updatePayload.isActive = isActive;
    if (credentials !== undefined) {
        const rawCreds = typeof credentials === "string" ? JSON.parse(credentials) : credentials;
        const mergedCredentials: Record<string, any> = {
            ...(existing.credentials as object),
            ...rawCreds,
        };
        if (rawCreds.apiKey && !rawCreds.apiKey.startsWith("******")) {
            mergedCredentials.apiKey = encryptSecret(rawCreds.apiKey);
        }
        if (rawCreds.hmac && !rawCreds.hmac.startsWith("******")) {
            mergedCredentials.hmac = encryptSecret(rawCreds.hmac);
        }
        if (rawCreds.secretKey && !rawCreds.secretKey.startsWith("******")) {
            mergedCredentials.secretKey = encryptSecret(rawCreds.secretKey);
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

    await db
        .delete(restaurantPaymentCredentials)
        .where(eq(restaurantPaymentCredentials.id, credentialId));

    res.status(200).json({
        success: true,
        message: "Payment credentials deleted successfully",
    });
};

/**
 * 5. Toggle active status of credentials
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

    await db
        .update(restaurantPaymentCredentials)
        .set({ isActive })
        .where(eq(restaurantPaymentCredentials.id, credentialId));

    res.status(200).json({
        success: true,
        message: `Payment credentials ${isActive ? "activated" : "deactivated"} successfully`,
    });
};