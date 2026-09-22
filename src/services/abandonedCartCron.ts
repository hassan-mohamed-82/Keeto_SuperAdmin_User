import cron from "node-cron";
import { db } from "../models/connection";
import { cartItems, users, orders, addresses } from "../models/schema";
import { eq, and, lt, inArray, sql } from "drizzle-orm";

export function initAbandonedCartCron() {
    console.log("⏰ Abandoned Guest Cart Cleanup Cron initialized...");

    // Run daily at 00:05 (midnight + 5 mins)
    cron.schedule("5 0 * * *", async () => {
        try {
            console.log("🧹 Running daily abandoned guest cart cleanup...");
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            // 1. Find inactive guest user IDs created more than 30 days ago
            const staleGuests = await db
                .select({ id: users.id })
                .from(users)
                .where(
                    and(
                        eq(users.isGuest, true),
                        lt(users.createdAt, thirtyDaysAgo)
                    )
                )
                .limit(500);

            if (!staleGuests.length) {
                console.log("🧹 No stale guest accounts found to clean up.");
                return;
            }

            const guestIds = staleGuests.map((u) => u.id);

            // 2. Identify which of these guest users have placed orders (we preserve them)
            const orderedGuestRows = await db
                .select({ userId: orders.userId })
                .from(orders)
                .where(inArray(orders.userId, guestIds));

            const orderedUserIds = new Set(orderedGuestRows.map((o) => o.userId));

            // Guest IDs that never placed any order
            const abandonGuestIds = guestIds.filter((id) => !orderedUserIds.has(id));

            if (abandonGuestIds.length > 0) {
                // 3. Delete stale cart items
                const deletedCarts = await db
                    .delete(cartItems)
                    .where(inArray(cartItems.userId, abandonGuestIds));

                // 4. Delete stale temporary addresses created for these guests
                await db
                    .delete(addresses)
                    .where(inArray(addresses.userId, abandonGuestIds));

                // 5. Delete empty shadow guest accounts
                await db
                    .delete(users)
                    .where(inArray(users.id, abandonGuestIds));

                console.log(
                    `✅ Cleaned up abandoned carts and guest data for ${abandonGuestIds.length} stale guest account(s).`
                );
            } else {
                console.log("🧹 All stale guest accounts had active orders, preserving records.");
            }
        } catch (error) {
            console.error("❌ Error running abandoned cart cleanup cron:", error);
        }
    });
}
