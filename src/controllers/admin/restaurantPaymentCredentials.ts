import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantPaymentCredentials, restaurants } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { encryptSecret } from "../../utils/encryption";

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

    if (!provider || !title || !credentials) {
        throw new BadRequest("Provider, title, and credentials are required");
    }

    // Encrypt sensitive credential fields before storing in database
    const encryptedCredentials = {
        ...credentials,
        apiKey: credentials.apiKey ? encryptSecret(credentials.apiKey) : "",
        hmac: credentials.hmac ? encryptSecret(credentials.hmac) : "",
    };

    const newId = uuidv4();

    await db.insert(restaurantPaymentCredentials).values({
        id: newId,
        restaurantId,
        provider,
        title: title ?? "PAYMOB",
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

    // Mask secret values in response
    const sanitizedData = created ? {
        ...created,
        credentials: {
            ...created.credentials,
            apiKey: "******",
            hmac: "******",
        }
    } : null;

    res.status(201).json({
        success: true,
        message: "Payment credentials created successfully",
        data: sanitizedData,
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

    const sanitizedList = list.map((item) => ({
        ...item,
        credentials: item.credentials ? {
            ...item.credentials,
            apiKey: "******",
            hmac: "******",
        } : null,
    }));

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
    if (provider !== undefined) updatePayload.provider = provider;
    if (title !== undefined) updatePayload.title = title;
    if (environment !== undefined) updatePayload.environment = environment;
    if (logoUrl !== undefined) updatePayload.logoUrl = logoUrl || null;
    if (isActive !== undefined) updatePayload.isActive = isActive;
    if (credentials !== undefined) {
        const mergedCredentials = {
            ...(existing.credentials as object),
            ...credentials,
        };
        if (credentials.apiKey && !credentials.apiKey.startsWith("******")) {
            mergedCredentials.apiKey = encryptSecret(credentials.apiKey);
        }
        if (credentials.hmac && !credentials.hmac.startsWith("******")) {
            mergedCredentials.hmac = encryptSecret(credentials.hmac);
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

    const sanitizedData = updated ? {
        ...updated,
        credentials: {
            ...updated.credentials,
            apiKey: "******",
            hmac: "******",
        }
    } : null;

    res.status(200).json({
        success: true,
        message: "Payment credentials updated successfully",
        data: sanitizedData,
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