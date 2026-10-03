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
 * Business rule: a restaurant on CUSTOM gateway must have exactly ONE active
 * provider — either their own Kashier account, Paymob account, or Geidea account,
 * never multiple at the same time.
 */
async function getActiveCustomGateway(restaurantId) {
    const activeCreds = await connection_1.db
        .select()
        .from(schema_1.restaurantPaymentCredentials)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantPaymentCredentials.isActive, true)));
    const kashierCreds = activeCreds.filter((c) => c.provider === "KASHIER");
    const paymobCreds = activeCreds.filter((c) => c.provider === "PAYMOB");
    const geideaCreds = activeCreds.filter((c) => c.provider === "GEIDEA");
    const activeProviderCount = (kashierCreds.length > 0 ? 1 : 0) +
        (paymobCreds.length > 0 ? 1 : 0) +
        (geideaCreds.length > 0 ? 1 : 0);
    if (activeProviderCount === 0) {
        return null;
    }
    if (activeProviderCount > 1) {
        throw new Errors_1.BadRequest(`Restaurant ${restaurantId} has multiple active payment providers (Kashier/Paymob/Geidea) at the same time. ` +
            `Only one custom payment provider may be active per restaurant — this needs to be fixed in restaurant payment settings.`);
    }
    if (kashierCreds.length > 1 || paymobCreds.length > 1 || geideaCreds.length > 1) {
        throw new Errors_1.BadRequest(`Restaurant ${restaurantId} has multiple active credential rows for the same provider. ` +
            `Only one active row per provider is allowed — this needs to be fixed in restaurant payment settings.`);
    }
    if (kashierCreds.length === 1) {
        return { provider: "KASHIER", record: ensureParsedCredentials(kashierCreds[0]) };
    }
    if (paymobCreds.length === 1) {
        return { provider: "PAYMOB", record: ensureParsedCredentials(paymobCreds[0]) };
    }
    return { provider: "GEIDEA", record: ensureParsedCredentials(geideaCreds[0]) };
}
