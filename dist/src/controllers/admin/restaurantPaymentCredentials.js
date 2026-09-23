"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toggleCredential = exports.deleteCredential = exports.updateCredential = exports.getCredentialsByRestaurant = exports.createCredentials = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const encryption_1 = require("../../utils/encryption");
/**
 * 1. Add/Create Payment Credentials for a restaurant
 */
const createCredentials = async (req, res) => {
    const restaurantId = req.params.restaurantId;
    if (!restaurantId) {
        throw new BadRequest_1.BadRequest("Restaurant ID is required");
    }
    const [restaurantExists] = await connection_1.db
        .select({ id: schema_1.restaurants.id })
        .from(schema_1.restaurants)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId))
        .limit(1);
    if (!restaurantExists) {
        throw new NotFound_1.NotFound("Restaurant not found");
    }
    const { provider, title, environment, credentials, logoUrl, isActive } = req.body;
    if (!provider || !title || !credentials) {
        throw new BadRequest_1.BadRequest("Provider, title, and credentials are required");
    }
    // Encrypt sensitive credential fields before storing in database
    const encryptedCredentials = {
        ...credentials,
        apiKey: credentials.apiKey ? (0, encryption_1.encryptSecret)(credentials.apiKey) : "",
        hmac: credentials.hmac ? (0, encryption_1.encryptSecret)(credentials.hmac) : "",
    };
    const newId = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.restaurantPaymentCredentials).values({
        id: newId,
        restaurantId,
        provider,
        title: title ?? "PAYMOB",
        environment: environment || "LIVE",
        credentials: encryptedCredentials,
        logoUrl: logoUrl || null,
        isActive: isActive !== undefined ? isActive : true,
    });
    const [created] = await connection_1.db
        .select()
        .from(schema_1.restaurantPaymentCredentials)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.id, newId))
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
exports.createCredentials = createCredentials;
/**
 * 2. Get all payment credentials for a restaurant
 */
const getCredentialsByRestaurant = async (req, res) => {
    const restaurantId = req.params.restaurantId;
    if (!restaurantId) {
        throw new BadRequest_1.BadRequest("Restaurant ID is required");
    }
    const list = await connection_1.db
        .select()
        .from(schema_1.restaurantPaymentCredentials)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, restaurantId));
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
exports.getCredentialsByRestaurant = getCredentialsByRestaurant;
/**
 * 3. Update a specific payment credential
 */
const updateCredential = async (req, res) => {
    const { restaurantId, credentialId } = req.params;
    if (!restaurantId || !credentialId) {
        throw new BadRequest_1.BadRequest("Restaurant ID and Credential ID are required");
    }
    const [existing] = await connection_1.db
        .select()
        .from(schema_1.restaurantPaymentCredentials)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.id, credentialId), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, restaurantId)))
        .limit(1);
    if (!existing) {
        throw new NotFound_1.NotFound("Payment credentials record not found");
    }
    const { provider, title, environment, credentials, logoUrl, isActive } = req.body;
    const updatePayload = {};
    if (provider !== undefined)
        updatePayload.provider = provider;
    if (title !== undefined)
        updatePayload.title = title;
    if (environment !== undefined)
        updatePayload.environment = environment;
    if (logoUrl !== undefined)
        updatePayload.logoUrl = logoUrl || null;
    if (isActive !== undefined)
        updatePayload.isActive = isActive;
    if (credentials !== undefined) {
        const mergedCredentials = {
            ...existing.credentials,
            ...credentials,
        };
        if (credentials.apiKey && !credentials.apiKey.startsWith("******")) {
            mergedCredentials.apiKey = (0, encryption_1.encryptSecret)(credentials.apiKey);
        }
        if (credentials.hmac && !credentials.hmac.startsWith("******")) {
            mergedCredentials.hmac = (0, encryption_1.encryptSecret)(credentials.hmac);
        }
        updatePayload.credentials = mergedCredentials;
    }
    if (Object.keys(updatePayload).length > 0) {
        await connection_1.db
            .update(schema_1.restaurantPaymentCredentials)
            .set(updatePayload)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.id, credentialId));
    }
    const [updated] = await connection_1.db
        .select()
        .from(schema_1.restaurantPaymentCredentials)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.id, credentialId))
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
exports.updateCredential = updateCredential;
/**
 * 4. Delete payment credentials
 */
const deleteCredential = async (req, res) => {
    const { restaurantId, credentialId } = req.params;
    if (!restaurantId || !credentialId) {
        throw new BadRequest_1.BadRequest("Restaurant ID and Credential ID are required");
    }
    const [existing] = await connection_1.db
        .select({ id: schema_1.restaurantPaymentCredentials.id })
        .from(schema_1.restaurantPaymentCredentials)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.id, credentialId), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, restaurantId)))
        .limit(1);
    if (!existing) {
        throw new NotFound_1.NotFound("Payment credentials record not found");
    }
    await connection_1.db
        .delete(schema_1.restaurantPaymentCredentials)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.id, credentialId));
    res.status(200).json({
        success: true,
        message: "Payment credentials deleted successfully",
    });
};
exports.deleteCredential = deleteCredential;
/**
 * 5. Toggle active status of credentials
 */
const toggleCredential = async (req, res) => {
    const { restaurantId, credentialId } = req.params;
    const { isActive } = req.body;
    if (!restaurantId || !credentialId) {
        throw new BadRequest_1.BadRequest("Restaurant ID and Credential ID are required");
    }
    if (typeof isActive !== "boolean") {
        throw new BadRequest_1.BadRequest("isActive must be a boolean value");
    }
    const [existing] = await connection_1.db
        .select({ id: schema_1.restaurantPaymentCredentials.id })
        .from(schema_1.restaurantPaymentCredentials)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.id, credentialId), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, restaurantId)))
        .limit(1);
    if (!existing) {
        throw new NotFound_1.NotFound("Payment credentials record not found");
    }
    await connection_1.db
        .update(schema_1.restaurantPaymentCredentials)
        .set({ isActive })
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.id, credentialId));
    res.status(200).json({
        success: true,
        message: `Payment credentials ${isActive ? "activated" : "deactivated"} successfully`,
    });
};
exports.toggleCredential = toggleCredential;
