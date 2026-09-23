"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAbandonedCartCron = initAbandonedCartCron;
const node_cron_1 = __importDefault(require("node-cron"));
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const GUEST_RETENTION_DAYS = 30;
const BATCH_SIZE = 500;
function initAbandonedCartCron() {
    console.log("⏰ Abandoned Guest Cart Cleanup Cron initialized...");
    // Run daily at 00:05 (midnight + 5 mins)
    node_cron_1.default.schedule("5 0 * * *", async () => {
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
                const staleGuests = await connection_1.db
                    .select({ id: schema_1.users.id })
                    .from(schema_1.users)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.users.isGuest, true), (0, drizzle_orm_1.eq)(schema_1.users.isDeleted, false), // don't touch already-merged/soft-deleted guests
                (0, drizzle_orm_1.lt)(schema_1.users.createdAt, cutoffDate)))
                    .limit(BATCH_SIZE);
                if (!staleGuests.length) {
                    if (safetyIterations === 1) {
                        console.log("🧹 No stale guest accounts found to clean up.");
                    }
                    break;
                }
                const guestIds = staleGuests.map((u) => u.id);
                // 2. Identify which of these guest users have placed orders (we preserve them)
                const orderedGuestRows = await connection_1.db
                    .select({ userId: schema_1.orders.userId })
                    .from(schema_1.orders)
                    .where((0, drizzle_orm_1.inArray)(schema_1.orders.userId, guestIds));
                const orderedUserIds = new Set(orderedGuestRows.map((o) => o.userId));
                const abandonGuestIds = guestIds.filter((id) => !orderedUserIds.has(id));
                const preservedGuestIds = guestIds.filter((id) => orderedUserIds.has(id));
                // 3. Delete stale data for abandoned guests (in a transaction, FK-safe order)
                if (abandonGuestIds.length > 0) {
                    await connection_1.db.transaction(async (tx) => {
                        // FK-safe deletion order (children before parent)
                        await tx.delete(schema_1.emailVerifications).where((0, drizzle_orm_1.inArray)(schema_1.emailVerifications.userId, abandonGuestIds));
                        await tx.delete(schema_1.redeemRequests).where((0, drizzle_orm_1.inArray)(schema_1.redeemRequests.userId, abandonGuestIds));
                        await tx.delete(schema_1.cartItems).where((0, drizzle_orm_1.inArray)(schema_1.cartItems.userId, abandonGuestIds));
                        await tx.delete(schema_1.addresses).where((0, drizzle_orm_1.inArray)(schema_1.addresses.userId, abandonGuestIds));
                        await tx.delete(schema_1.favorites).where((0, drizzle_orm_1.inArray)(schema_1.favorites.userId, abandonGuestIds));
                        await tx.delete(schema_1.userFcmTokens).where((0, drizzle_orm_1.inArray)(schema_1.userFcmTokens.userId, abandonGuestIds));
                        await tx.delete(schema_1.userAddHome).where((0, drizzle_orm_1.inArray)(schema_1.userAddHome.userId, abandonGuestIds));
                        await tx.delete(schema_1.restaurant_users).where((0, drizzle_orm_1.inArray)(schema_1.restaurant_users.userId, abandonGuestIds));
                        // CASCADE will auto-delete: user_wallets, user_wallet_transactions,
                        // user_restaurant_points, user_points_transactions
                        await tx.delete(schema_1.users).where((0, drizzle_orm_1.inArray)(schema_1.users.id, abandonGuestIds));
                    });
                    totalCleaned += abandonGuestIds.length;
                }
                // 4. Guests with orders are preserved permanently — mark them so future
                //    batches don't keep re-selecting the same rows forever.
                if (preservedGuestIds.length > 0) {
                    await connection_1.db
                        .update(schema_1.users)
                        .set({ isGuest: false }) // no longer treated as an "abandoned guest" candidate
                        .where((0, drizzle_orm_1.inArray)(schema_1.users.id, preservedGuestIds));
                    totalPreserved += preservedGuestIds.length;
                }
                // If the batch came back smaller than BATCH_SIZE, we've reached the end
                if (staleGuests.length < BATCH_SIZE)
                    break;
            }
            if (safetyIterations >= MAX_ITERATIONS) {
                console.warn("⚠️ Abandoned cart cleanup hit max iteration safety cap, stopping early.");
            }
            if (totalCleaned > 0 || totalPreserved > 0) {
                console.log(`✅ Cleanup complete: removed ${totalCleaned} abandoned guest account(s), preserved ${totalPreserved} guest account(s) with orders.`);
            }
        }
        catch (error) {
            console.error("❌ Error running abandoned cart cleanup cron:", error);
        }
    });
}
