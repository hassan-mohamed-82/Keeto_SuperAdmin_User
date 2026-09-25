import { BadRequest } from "../Errors";
import { restaurantPaymentCredentials } from "../models/schema";
import { eq, and } from "drizzle-orm";
import { db } from "../models/connection";

export type ActiveCustomGateway =
    | { provider: "KASHIER"; record: typeof restaurantPaymentCredentials.$inferSelect }
    | { provider: "PAYMOB"; record: typeof restaurantPaymentCredentials.$inferSelect };

/**
 * Resolves the single active CUSTOM payment provider for a restaurant.
 *
 * Business rule: a restaurant on CUSTOM gateway must have exactly ONE active
 * provider — either their own Kashier account OR their own Paymob account,
 * never both at the same time.
 *
 * - Returns `null` if the restaurant has no active custom credentials at all
 *   (caller should treat this as "custom gateway misconfigured").
 * - Throws BadRequest if MORE THAN ONE provider is active (Kashier + Paymob
 *   both active, or duplicate active rows for the same provider). This is a
 *   data-integrity problem and must never be silently resolved by picking one
 *   — previously the checkout controller defaulted to Kashier in this case,
 *   which hides a misconfiguration instead of surfacing it.
 *
 * Whoever owns the "activate credential" endpoint should also deactivate any
 * other active credential for the same restaurant in the same DB transaction,
 * so this function is a defense-in-depth check, not the only guard.
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

    if (kashierCreds.length === 0 && paymobCreds.length === 0) {
        return null;
    }

    if (kashierCreds.length > 0 && paymobCreds.length > 0) {
        throw new BadRequest(
            `Restaurant ${restaurantId} has both Kashier and Paymob active at the same time. ` +
            `Only one custom payment provider may be active per restaurant — this needs to be fixed in restaurant payment settings.`
        );
    }

    if (kashierCreds.length > 1 || paymobCreds.length > 1) {
        throw new BadRequest(
            `Restaurant ${restaurantId} has multiple active credential rows for the same provider. ` +
            `Only one active row per provider is allowed — this needs to be fixed in restaurant payment settings.`
        );
    }

    if (kashierCreds.length === 1) {
        return { provider: "KASHIER", record: kashierCreds[0] };
    }

    return { provider: "PAYMOB", record: paymobCreds[0] };
}