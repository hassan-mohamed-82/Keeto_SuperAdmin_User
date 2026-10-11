// src/helpers/firstOrderDiscount.helper.ts
import { db } from "../models/connection";
import {
    firstOrderDiscounts,
    firstOrderDiscountUsages,
    orders,
} from "../models/schema";
import { eq, and, sql, count, lte, gte, isNull, or } from "drizzle-orm";
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
 *  3. global usage (usedCount < maxUsage) not exceeded
 *  4. user's per-usage (usages for this discount < maxUsagePerUser)
 *  5. user's total COMPLETED orders at this restaurant < firstOrderCount
 *
 * If multiple discounts qualify, we return the one giving the MAXIMUM discount.
 *
 * @param userId       - the ordering user
 * @param restaurantId - the restaurant
 * @param subtotal     - order subtotal BEFORE this discount (used for value calc)
 * @returns null if no discount qualifies
 */
export const resolveFirstOrderDiscount = async (
    userId: string,
    restaurantId: string,
    subtotal: number
): Promise<FirstOrderDiscountResult | null> => {
    const now = new Date();

    // 1. Fetch all active discounts for this restaurant within the date window
    const candidates = await db
        .select()
        .from(firstOrderDiscounts)
        .where(
            and(
                eq(firstOrderDiscounts.restaurantId, restaurantId),
                eq(firstOrderDiscounts.status, "active"),
                or(isNull(firstOrderDiscounts.startDate), lte(firstOrderDiscounts.startDate, now)),
                or(isNull(firstOrderDiscounts.endDate), gte(firstOrderDiscounts.endDate, now)),
            )
        );

    if (candidates.length === 0) return null;

    // 2. Count the user's completed orders at this restaurant
    const [orderCountRow] = await db
        .select({ cnt: count(orders.id) })
        .from(orders)
        .where(
            and(
                eq(orders.userId, userId),
                eq(orders.restaurantId, restaurantId),
                // Only count successfully placed orders (not cancelled / failed)
                sql`${orders.status} NOT IN ('cancelled', 'failed')`
            )
        );
    const userOrderCount = Number(orderCountRow?.cnt ?? 0);

    // 3. Fetch per-discount usage counts for this user (in one batch)
    const discountIds = candidates.map(d => d.id);

    const userUsages = discountIds.length > 0
        ? await db
            .select({
                firstOrderDiscountId: firstOrderDiscountUsages.firstOrderDiscountId,
                usageCount: count(firstOrderDiscountUsages.id),
            })
            .from(firstOrderDiscountUsages)
            .where(
                and(
                    eq(firstOrderDiscountUsages.userId, userId),
                    sql`${firstOrderDiscountUsages.firstOrderDiscountId} IN (${sql.join(
                        discountIds.map(id => sql`${id}`),
                        sql`, `
                    )})`
                )
            )
            .groupBy(firstOrderDiscountUsages.firstOrderDiscountId)
        : [];

    const userUsageMap = new Map<string, number>(
        userUsages.map(u => [u.firstOrderDiscountId, Number(u.usageCount)])
    );

    // 4. Filter to eligible discounts and calculate each discount amount
    let bestResult: FirstOrderDiscountResult | null = null;

    for (const discount of candidates) {
        // a) Global usage limit
        if (discount.maxUsage !== null && (discount.usedCount ?? 0) >= discount.maxUsage) continue;

        // b) Per-user usage limit
        const userUsed = userUsageMap.get(discount.id) ?? 0;
        if (userUsed >= discount.maxUsagePerUser) continue;

        // c) User's order count must be < firstOrderCount
        //    (i.e. this is one of their first N orders, NOT already placed)
        if (userOrderCount >= discount.firstOrderCount) continue;

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

