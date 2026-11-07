"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveCustomGateway = getActiveCustomGateway;
const Errors_1 = require("../Errors");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../models/connection");
function ensureParsedCredentials(record) {
    let creds = record.credentials;
    // ممكن الـ string يكون متكرر أكتر من مرة (double/triple encoded) في حالات نادرة،
    // فبنحاول نعمل parse لحد ما نوصل لـ object حقيقي أو نفشل بوضوح.
    let attempts = 0;
    while (typeof creds === "string" && attempts < 3) {
        try {
            creds = JSON.parse(creds);
        }
        catch (err) {
            console.error(`[getActiveCustomGateway] Failed to parse credentials JSON string for row ${record.id} (provider: ${record.provider}):`, err);
            throw new Errors_1.BadRequest(`Payment credentials for provider ${record.provider} are stored in an invalid format. Please re-save them from the restaurant settings.`);
        }
        attempts++;
    }
    if (typeof creds !== "object" || creds === null) {
        throw new Errors_1.BadRequest(`Payment credentials for provider ${record.provider} are not a valid object after parsing.`);
    }
    return { ...record, credentials: creds };
}
/**
 * Resolves the single active CUSTOM payment provider for a restaurant.
 *
 * Strict business rule: A restaurant on CUSTOM gateway must have exactly ONE active
 * credential row at a time. Never multiple at the same time.
 *
 * If no credential is explicitly active, it falls back to the restaurant's default
 * credential (isDefault = true).
 */
async function getActiveCustomGateway(restaurantId) {
    const activeCreds = await connection_1.db
        .select()
        .from(schema_1.restaurantPaymentCredentials)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.isActive, true)));
    // If more than one credential is active, reject immediately — exactly ONE can be active
    if (activeCreds.length > 1) {
        throw new Errors_1.BadRequest(`Restaurant ${restaurantId} has multiple active payment credentials. ` +
            `Only one payment credential may be active per restaurant at a time — this needs to be fixed in restaurant payment settings.`);
    }
    // Exactly one active credential found
    if (activeCreds.length === 1) {
        const row = activeCreds[0];
        return {
            provider: row.provider,
            record: ensureParsedCredentials(row),
        };
    }
    // Fallback: If no credential is active, use the default credential (isDefault = true)
    const [defaultCred] = await connection_1.db
        .select()
        .from(schema_1.restaurantPaymentCredentials)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.isDefault, true)))
        .limit(1);
    if (defaultCred) {
        return {
            provider: defaultCred.provider,
            record: ensureParsedCredentials(defaultCred),
        };
    }
    return null;
}
