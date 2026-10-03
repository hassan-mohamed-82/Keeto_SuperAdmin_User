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
// Helper to sanitize credential secrets before sending in response
const sanitizeCredentialRecord = (record) => {
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
    // Auto-heal if previously corrupted with character-spread keys: { 0: '{', 1: '"', ... }
    if (creds && typeof creds === "object" && "0" in creds && !("mid" in creds) && !("apiKey" in creds)) {
        try {
            const reconstructed = Object.keys(creds)
                .sort((a, b) => Number(a) - Number(b))
                .map((k) => creds[k])
                .join("");
            creds = JSON.parse(reconstructed);
        }
        catch { }
    }
    const safeCreds = creds && typeof creds === "object" ? { ...creds } : {};
    if (safeCreds.apiKey)
        safeCreds.apiKey = "******";
    if (safeCreds.hmac)
        safeCreds.hmac = "******";
    if (safeCreds.secretKey)
        safeCreds.secretKey = "******";
    if (safeCreds.apiPassword)
        safeCreds.apiPassword = "******";
    return {
        ...record,
        credentials: safeCreds,
    };
};
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
    if (!provider || !credentials) {
        throw new BadRequest_1.BadRequest("Provider and credentials are required");
    }
    const rawCreds = typeof credentials === "string" ? JSON.parse(credentials) : credentials;
    // Encrypt sensitive credential fields before storing in database
    const encryptedCredentials = { ...rawCreds };
    if (rawCreds.apiKey && !rawCreds.apiKey.startsWith("******")) {
        encryptedCredentials.apiKey = (0, encryption_1.encryptSecret)(rawCreds.apiKey);
    }
    if (rawCreds.hmac && !rawCreds.hmac.startsWith("******")) {
        encryptedCredentials.hmac = (0, encryption_1.encryptSecret)(rawCreds.hmac);
    }
    if (rawCreds.secretKey && !rawCreds.secretKey.startsWith("******")) {
        encryptedCredentials.secretKey = (0, encryption_1.encryptSecret)(rawCreds.secretKey);
    }
    if (rawCreds.apiPassword && !rawCreds.apiPassword.startsWith("******")) {
        encryptedCredentials.apiPassword = (0, encryption_1.encryptSecret)(rawCreds.apiPassword);
    }
    const newId = (0, uuid_1.v4)();
    const formattedProvider = String(provider).toUpperCase();
    await connection_1.db.insert(schema_1.restaurantPaymentCredentials).values({
        id: newId,
        restaurantId,
        provider: formattedProvider,
        title: title || formattedProvider,
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
    res.status(201).json({
        success: true,
        message: "Payment credentials created successfully",
        data: sanitizeCredentialRecord(created),
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
    const sanitizedList = list.map(sanitizeCredentialRecord);
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
        updatePayload.provider = String(provider).toUpperCase();
    if (title !== undefined)
        updatePayload.title = title;
    if (environment !== undefined)
        updatePayload.environment = environment;
    if (logoUrl !== undefined)
        updatePayload.logoUrl = logoUrl || null;
    if (isActive !== undefined)
        updatePayload.isActive = isActive;
    if (credentials !== undefined) {
        let rawCreds = credentials;
        if (typeof rawCreds === "string") {
            try {
                rawCreds = JSON.parse(rawCreds);
            }
            catch {
                rawCreds = {};
            }
        }
        let existingCreds = existing.credentials;
        if (typeof existingCreds === "string") {
            try {
                existingCreds = JSON.parse(existingCreds);
            }
            catch {
                existingCreds = {};
            }
        }
        if (existingCreds && typeof existingCreds === "object" && "0" in existingCreds && !("mid" in existingCreds) && !("apiKey" in existingCreds)) {
            try {
                const reconstructed = Object.keys(existingCreds)
                    .sort((a, b) => Number(a) - Number(b))
                    .map((k) => existingCreds[k])
                    .join("");
                existingCreds = JSON.parse(reconstructed);
            }
            catch { }
        }
        const sensitiveFields = ["apiKey", "hmac", "secretKey", "apiPassword"];
        const mergedCredentials = {
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
                mergedCredentials[field] = (0, encryption_1.encryptSecret)(incomingVal.trim());
            }
            else if (existingCreds?.[field] !== undefined && existingCreds?.[field] !== null && existingCreds?.[field] !== "") {
                mergedCredentials[field] = existingCreds[field];
            }
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
    res.status(200).json({
        success: true,
        message: "Payment credentials updated successfully",
        data: sanitizeCredentialRecord(updated),
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
