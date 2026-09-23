import cron from "node-cron";
import { db } from "../models/connection";
import {
    cartItems,
    users,
    orders,
    addresses,
    favorites,
    userFcmTokens,
    emailVerifications,
    userAddHome,
    restaurant_users,
    redeemRequests,
} from "../models/schema";
import { eq, and, lt, inArray } from "drizzle-orm";

const GUEST_RETENTION_DAYS = 30;
const BATCH_SIZE = 500;

export function initAbandonedCartCron() {
    console.log("⏰ Abandoned Guest Cart Cleanup Cron initialized...");

    // Run daily at 00:05 (midnight + 5 mins)
    cron.schedule("5 0 * * *", async () => {
        try {
            console.log("🧹 Running daily abandoned guest cart cleanup...");
            const cutoffDate = new Date(Date.now() - GUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000);

            let totalCleaned = 0;
            let totalPreserved = 0;
            let safetyIterations = 0;
            const MAX_ITERATIONS = 200; // safety cap: up to 100k guests per run

            while (safetyIterations < MAX_ITERATIONS) {
                safetyIterations++;

                // 1. Find a batch of stale, non-merged guest accounts
                const staleGuests = await db
                    .select({ id: users.id })
                    .from(users)
                    .where(
                        and(
                            eq(users.isGuest, true),
                            eq(users.isDeleted, false), // don't touch already-merged/soft-deleted guests
                            lt(users.createdAt, cutoffDate)
                        )
                    )
                    .limit(BATCH_SIZE);

                if (!staleGuests.length) {
                    if (safetyIterations === 1) {
                        console.log("🧹 No stale guest accounts found to clean up.");
                    }
                    break;
                }

                const guestIds = staleGuests.map((u) => u.id);

                // 2. Identify which of these guest users have placed orders (we preserve them)
                const orderedGuestRows = await db
                    .select({ userId: orders.userId })
                    .from(orders)
                    .where(inArray(orders.userId, guestIds));

                const orderedUserIds = new Set(orderedGuestRows.map((o) => o.userId));

                const abandonGuestIds = guestIds.filter((id) => !orderedUserIds.has(id));
                const preservedGuestIds = guestIds.filter((id) => orderedUserIds.has(id));

                // 3. Delete stale data for abandoned guests (in a transaction, FK-safe order)
                if (abandonGuestIds.length > 0) {
                    await db.transaction(async (tx) => {
                        // FK-safe deletion order (children before parent)
                        await tx.delete(emailVerifications).where(inArray(emailVerifications.userId, abandonGuestIds));
                        await tx.delete(redeemRequests).where(inArray(redeemRequests.userId, abandonGuestIds));
                        await tx.delete(cartItems).where(inArray(cartItems.userId, abandonGuestIds));
                        await tx.delete(addresses).where(inArray(addresses.userId, abandonGuestIds));
                        await tx.delete(favorites).where(inArray(favorites.userId, abandonGuestIds));
                        await tx.delete(userFcmTokens).where(inArray(userFcmTokens.userId, abandonGuestIds));
                        await tx.delete(userAddHome).where(inArray(userAddHome.userId, abandonGuestIds));
                        await tx.delete(restaurant_users).where(inArray(restaurant_users.userId, abandonGuestIds));
                        // CASCADE will auto-delete: user_wallets, user_wallet_transactions,
                        // user_restaurant_points, user_points_transactions
                        await tx.delete(users).where(inArray(users.id, abandonGuestIds));
                    });

                    totalCleaned += abandonGuestIds.length;
                }

                // 4. Guests with orders are preserved permanently — mark them so future
                //    batches don't keep re-selecting the same rows forever.
                if (preservedGuestIds.length > 0) {
                    await db
                        .update(users)
                        .set({ isGuest: false }) // no longer treated as an "abandoned guest" candidate
                        .where(inArray(users.id, preservedGuestIds));

                    totalPreserved += preservedGuestIds.length;
                }

                // If the batch came back smaller than BATCH_SIZE, we've reached the end
                if (staleGuests.length < BATCH_SIZE) break;
            }

            if (safetyIterations >= MAX_ITERATIONS) {
                console.warn("⚠️ Abandoned cart cleanup hit max iteration safety cap, stopping early.");
            }

            if (totalCleaned > 0 || totalPreserved > 0) {
                console.log(
                    `✅ Cleanup complete: removed ${totalCleaned} abandoned guest account(s), preserved ${totalPreserved} guest account(s) with orders.`
                );
            }
        } catch (error) {
            console.error("❌ Error running abandoned cart cleanup cron:", error);
        }
    });
}