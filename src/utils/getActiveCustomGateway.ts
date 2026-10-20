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
 * Strict business rule: A restaurant on CUSTOM gateway must have exactly ONE active
 * credential row at a time. Never multiple at the same time.
 *
 * If no credential is explicitly active, it falls back to the restaurant's default
 * credential (isDefault = true).
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

    // If more than one credential is active, reject immediately — exactly ONE can be active
    if (activeCreds.length > 1) {
        throw new BadRequest(
            `Restaurant ${restaurantId} has multiple active payment credentials. ` +
            `Only one payment credential may be active per restaurant at a time — this needs to be fixed in restaurant payment settings.`
        );
    }

    // Exactly one active credential found
    if (activeCreds.length === 1) {
        const row = activeCreds[0];
        return {
            provider: row.provider as "KASHIER" | "PAYMOB" | "GEIDEA",
            record: ensureParsedCredentials(row),
        };
    }

    // Fallback: If no credential is active, use the default credential (isDefault = true)
    const [defaultCred] = await db
        .select()
        .from(restaurantPaymentCredentials)
        .where(
            and(
                eq(restaurantPaymentCredentials.restaurantId, restaurantId),
                eq(restaurantPaymentCredentials.isDefault, true)
            )
        )
        .limit(1);

    if (defaultCred) {
        return {
            provider: defaultCred.provider as "KASHIER" | "PAYMOB" | "GEIDEA",
            record: ensureParsedCredentials(defaultCred),
        };
    }

    return null;
}
