// src/helpers/firstOrderDiscount.helper.ts
import { db } from "../models/connection";
import {
    firstOrderDiscounts,
    firstOrderDiscountUsages,
    orders,
    users,
} from "../models/schema";
import { eq, and, ne, sql, count, lte, gte, isNull, or, inArray } from "drizzle-orm";
import { BadRequest } from "../Errors/BadRequest";

export type FirstOrderDiscountResult = {
    discount: typeof firstOrderDiscounts.$inferSelect;
    discountAmount: number;
};

/**
 * Checks whether a user qualifies for ANY active first-order discount
 * at the given restaurant and computes the discount amount.
 *
 * Eligibility rules (all must pass):
 *  1. discount.status === 'active'
 *  2. within startDate / endDate window
 *  3. matching channel ("all" or matching orderSource channel)
 *  4. global usage (usedCount < maxUsage) not exceeded (if maxUsage is set)
 *  5. user's (and device's) total active/completed orders at this restaurant < firstOrderCount
 *  6. per-user usage cap (maxUsagePerUser) across any accounts on the same deviceId
 *
 * If multiple discounts qualify, we return the one giving the MAXIMUM discount.
 *
 * @param userId       - the ordering user
 * @param restaurantId - the restaurant
 * @param subtotal     - order subtotal BEFORE this discount (used for value calc)
 * @param orderSource  - e.g. "pos", "online_order_app", etc.
 * @returns null if no discount qualifies
 */
export const resolveFirstOrderDiscount = async (
    userId: string,
    restaurantId: string,
    subtotal: number,
    orderSource?: string | null
): Promise<FirstOrderDiscountResult | null> => {
    const now = new Date();

    // Channel matching: resolve target channels based on orderSource ("pos", "online_order_app", "online_order_web", etc.)
    const src = String(orderSource || "").trim().toLowerCase();
    const targetChannels: ("all" | "app" | "web" | "pos")[] = ["all"];
    if (src === "pos") {
        targetChannels.push("pos");
    } else if (src.includes("web") || src === "food_aggregator" || src === "mykeeto") {
        targetChannels.push("web");
    } else if (src.includes("app")) {
        targetChannels.push("app");
    } else {
        // Fallback if unspecified: allow both app and web
        targetChannels.push("app", "web");
    }

    // 1. Fetch all active discounts for this restaurant within the date window & channel
    const candidates = await db
        .select()
        .from(firstOrderDiscounts)
        .where(
            and(
                eq(firstOrderDiscounts.restaurantId, restaurantId),
                eq(firstOrderDiscounts.status, "active"),
                inArray(firstOrderDiscounts.channel, targetChannels),
                or(isNull(firstOrderDiscounts.startDate), lte(firstOrderDiscounts.startDate, now)),
                or(isNull(firstOrderDiscounts.endDate), gte(firstOrderDiscounts.endDate, now)),
            )
        );

    if (candidates.length === 0) return null;

    // 2. Anti-fraud check: resolve all user accounts linked to this deviceId
    const [currentUser] = await db
        .select({ deviceId: users.deviceId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    let userIdsToCheck: string[] = [userId];
    if (currentUser?.deviceId && currentUser.deviceId.trim()) {
        const sameDeviceUsers = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.deviceId, currentUser.deviceId.trim()));
        if (sameDeviceUsers.length > 0) {
            userIdsToCheck = Array.from(new Set([userId, ...sameDeviceUsers.map(u => u.id)]));
        }
    }

    // 3. Count total completed/active orders across all accounts sharing this deviceId at this restaurant
    const userCondition = userIdsToCheck.length === 1
        ? eq(orders.userId, userIdsToCheck[0])
        : inArray(orders.userId, userIdsToCheck);

    const [orderCountRow] = await db
        .select({ cnt: count(orders.id) })
        .from(orders)
        .where(
            and(
                userCondition,
                eq(orders.restaurantId, restaurantId),
                // Exclude failed orders, pending visa payments, and orders cancelled by restaurant
                ne(orders.status, 'failed'),
                sql`NOT (${orders.paymentStatus} = 'pending_payment' AND ${orders.status} = 'pending')`,
                sql`NOT (${orders.status} = 'cancelled' AND ${orders.cancelReasonType} = 'restaurant')`
            )
        );
    const userOrderCount = Number(orderCountRow?.cnt ?? 0);

    // 4. Filter to eligible discounts and calculate each discount amount
    let bestResult: FirstOrderDiscountResult | null = null;

    for (const discount of candidates) {
        // a) Global campaign usage limit (if set by restaurant)
        if (discount.maxUsage !== null && (discount.usedCount ?? 0) >= discount.maxUsage) continue;

        // b) User qualifies as long as their completed/active orders on this device at this restaurant < firstOrderCount
        if (userOrderCount >= discount.firstOrderCount) continue;

        // c) Check per-user usage cap across all accounts on this device (if set)
        if (discount.maxUsagePerUser !== null) {
            const usageCondition = userIdsToCheck.length === 1
                ? eq(firstOrderDiscountUsages.userId, userIdsToCheck[0])
                : inArray(firstOrderDiscountUsages.userId, userIdsToCheck);

            const [usageCountRow] = await db
                .select({ cnt: count(firstOrderDiscountUsages.id) })
                .from(firstOrderDiscountUsages)
                .where(
                    and(
                        eq(firstOrderDiscountUsages.firstOrderDiscountId, discount.id),
                        usageCondition
                    )
                );
            const deviceUsageCount = Number(usageCountRow?.cnt ?? 0);
            if (deviceUsageCount >= discount.maxUsagePerUser) continue;
        }

        // d) Compute discount amount
        const value = Math.max(0, Number(discount.discountValue ?? 0));
        let discountAmount = 0;

        if (discount.discountType === "percentage") {
            discountAmount = subtotal * (value / 100);
            if (discount.maxDiscountAmount) {
                const cap = Math.max(0, Number(discount.maxDiscountAmount));
                if (cap > 0) discountAmount = Math.min(discountAmount, cap);
            }
        } else {
            // fixed
            discountAmount = Math.min(value, subtotal);
        }

        discountAmount = Math.max(0, Math.round(discountAmount * 100) / 100);

        // e) Keep the one that gives the MAXIMUM discount
        if (bestResult === null || discountAmount > bestResult.discountAmount) {
            bestResult = { discount, discountAmount };
        }
    }

    return bestResult;
};

/**
 * Records a first-order discount redemption and increments the global usedCount.
 * Can be called with a transaction (tx) or falls back to db.
 */
export const recordFirstOrderDiscountUsage = async (
    firstOrderDiscountId: string,
    userId: string,
    orderId: string,
    discountAmount: number,
    txClient?: any
): Promise<void> => {
    const client = txClient || db;
    await Promise.all([
        client.insert(firstOrderDiscountUsages).values({
            id: crypto.randomUUID(),
            firstOrderDiscountId,
            userId,
            orderId,
            discountAmount: discountAmount.toFixed(2),
        }),
        client
            .update(firstOrderDiscounts)
            .set({ usedCount: sql`${firstOrderDiscounts.usedCount} + 1` })
            .where(eq(firstOrderDiscounts.id, firstOrderDiscountId)),
    ]);
};

