"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordFirstOrderDiscountUsage = exports.resolveFirstOrderDiscount = void 0;
// src/helpers/firstOrderDiscount.helper.ts
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
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
const resolveFirstOrderDiscount = async (userId, restaurantId, subtotal) => {
    const now = new Date();
    // 1. Fetch all active discounts for this restaurant within the date window
    const candidates = await connection_1.db
        .select()
        .from(schema_1.firstOrderDiscounts)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.firstOrderDiscounts.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.firstOrderDiscounts.status, "active"), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.firstOrderDiscounts.startDate), (0, drizzle_orm_1.lte)(schema_1.firstOrderDiscounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.firstOrderDiscounts.endDate), (0, drizzle_orm_1.gte)(schema_1.firstOrderDiscounts.endDate, now))));
    if (candidates.length === 0)
        return null;
    // 2. Count the user's completed orders at this restaurant
    const [orderCountRow] = await connection_1.db
        .select({ cnt: (0, drizzle_orm_1.count)(schema_1.orders.id) })
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.userId, userId), (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), 
    // Only count successfully placed orders (not cancelled / failed)
    (0, drizzle_orm_1.sql) `${schema_1.orders.status} NOT IN ('cancelled', 'failed')`));
    const userOrderCount = Number(orderCountRow?.cnt ?? 0);
    // 3. Fetch per-discount usage counts for this user (in one batch)
    const discountIds = candidates.map(d => d.id);
    const userUsages = discountIds.length > 0
        ? await connection_1.db
            .select({
            firstOrderDiscountId: schema_1.firstOrderDiscountUsages.firstOrderDiscountId,
            usageCount: (0, drizzle_orm_1.count)(schema_1.firstOrderDiscountUsages.id),
        })
            .from(schema_1.firstOrderDiscountUsages)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.firstOrderDiscountUsages.userId, userId), (0, drizzle_orm_1.sql) `${schema_1.firstOrderDiscountUsages.firstOrderDiscountId} IN (${drizzle_orm_1.sql.join(discountIds.map(id => (0, drizzle_orm_1.sql) `${id}`), (0, drizzle_orm_1.sql) `, `)})`))
            .groupBy(schema_1.firstOrderDiscountUsages.firstOrderDiscountId)
        : [];
    const userUsageMap = new Map(userUsages.map(u => [u.firstOrderDiscountId, Number(u.usageCount)]));
    // 4. Filter to eligible discounts and calculate each discount amount
    let bestResult = null;
    for (const discount of candidates) {
        // a) Global usage limit
        if (discount.maxUsage !== null && (discount.usedCount ?? 0) >= discount.maxUsage)
            continue;
        // b) Per-user usage limit
        const userUsed = userUsageMap.get(discount.id) ?? 0;
        if (userUsed >= discount.maxUsagePerUser)
            continue;
        // c) User's order count must be < firstOrderCount
        //    (i.e. this is one of their first N orders, NOT already placed)
        if (userOrderCount >= discount.firstOrderCount)
            continue;
        // d) Compute discount amount
        const value = Math.max(0, Number(discount.discountValue ?? 0));
        let discountAmount = 0;
        if (discount.discountType === "percentage") {
            discountAmount = subtotal * (value / 100);
            if (discount.maxDiscountAmount) {
                const cap = Math.max(0, Number(discount.maxDiscountAmount));
                if (cap > 0)
                    discountAmount = Math.min(discountAmount, cap);
            }
        }
        else {
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
exports.resolveFirstOrderDiscount = resolveFirstOrderDiscount;
/**
 * Records a first-order discount redemption and increments the global usedCount.
 * Can be called with a transaction (tx) or falls back to db.
 */
const recordFirstOrderDiscountUsage = async (firstOrderDiscountId, userId, orderId, discountAmount, txClient) => {
    const client = txClient || connection_1.db;
    await Promise.all([
        client.insert(schema_1.firstOrderDiscountUsages).values({
            id: crypto.randomUUID(),
            firstOrderDiscountId,
            userId,
            orderId,
            discountAmount: discountAmount.toFixed(2),
        }),
        client
            .update(schema_1.firstOrderDiscounts)
            .set({ usedCount: (0, drizzle_orm_1.sql) `${schema_1.firstOrderDiscounts.usedCount} + 1` })
            .where((0, drizzle_orm_1.eq)(schema_1.firstOrderDiscounts.id, firstOrderDiscountId)),
    ]);
};
exports.recordFirstOrderDiscountUsage = recordFirstOrderDiscountUsage;
