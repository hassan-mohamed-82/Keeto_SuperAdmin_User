import { BadRequest } from "../Errors";
import { restaurantPaymentCredentials } from "../models/schema";
import { eq, and } from "drizzle-orm";
import { db } from "../models/connection";

export type ActiveCustomGateway =
    | { provider: "KASHIER"; record: typeof restaurantPaymentCredentials.$inferSelect }
    | { provider: "PAYMOB"; record: typeof restaurantPaymentCredentials.$inferSelect }
    | { provider: "GEIDEA"; record: typeof restaurantPaymentCredentials.$inferSelect };

function ensureParsedCredentials(
    record: typeof restaurantPaymentCredentials.$inferSelect
): typeof restaurantPaymentCredentials.$inferSelect {
    let creds: any = record.credentials;

    // ممكن الـ string يكون متكرر أكتر من مرة (double/triple encoded) في حالات نادرة،
    // فبنحاول نعمل parse لحد ما نوصل لـ object حقيقي أو نفشل بوضوح.
    let attempts = 0;
    while (typeof creds === "string" && attempts < 3) {
        try {
            creds = JSON.parse(creds);
        } catch (err) {
            console.error(
                `[getActiveCustomGateway] Failed to parse credentials JSON string for row ${record.id} (provider: ${record.provider}):`,
                err
            );
            throw new BadRequest(
                `Payment credentials for provider ${record.provider} are stored in an invalid format. Please re-save them from the restaurant settings.`
            );
        }
        attempts++;
    }

    if (typeof creds !== "object" || creds === null) {
        throw new BadRequest(
            `Payment credentials for provider ${record.provider} are not a valid object after parsing.`
        );
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
export async function getActiveCustomGateway(restaurantId: string): Promise<ActiveCustomGateway | null> {
    const activeCreds = await db
        .select()
        .from(restaurantPaymentCredentials)
        .where(
            and(
                eq(restaurantPaymentCredentials.restaurantId, restaurantId),
                eq(restaurantPaymentCredentials.isActive, true)
            )
        );

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
        throw new BadRequest(
            `Restaurant ${restaurantId} has multiple active payment providers (Kashier/Paymob/Geidea) at the same time. ` +
            `Only one custom payment provider may be active per restaurant — this needs to be fixed in restaurant payment settings.`
        );
    }

    if (kashierCreds.length > 1 || paymobCreds.length > 1 || geideaCreds.length > 1) {
        throw new BadRequest(
            `Restaurant ${restaurantId} has multiple active credential rows for the same provider. ` +
            `Only one active row per provider is allowed — this needs to be fixed in restaurant payment settings.`
        );
    }

    if (kashierCreds.length === 1) {
        return { provider: "KASHIER", record: ensureParsedCredentials(kashierCreds[0]) };
    }

    if (paymobCreds.length === 1) {
        return { provider: "PAYMOB", record: ensureParsedCredentials(paymobCreds[0]) };
    }

    return { provider: "GEIDEA", record: ensureParsedCredentials(geideaCreds[0]) };
}