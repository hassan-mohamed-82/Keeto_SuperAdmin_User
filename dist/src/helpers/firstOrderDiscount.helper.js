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
 *  3. global usage (usedCount < maxUsage) not exceeded (if maxUsage is set)
 *  4. user's total active/completed orders at this restaurant < firstOrderCount (أول N طلبات للعميل في هذا المطعم)
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
    // Exclude failed orders, pending visa payments, and orders cancelled by restaurant
    (0, drizzle_orm_1.ne)(schema_1.orders.status, 'failed'), (0, drizzle_orm_1.sql) `NOT (${schema_1.orders.paymentStatus} = 'pending_payment' AND ${schema_1.orders.status} = 'pending')`, (0, drizzle_orm_1.sql) `NOT (${schema_1.orders.status} = 'cancelled' AND ${schema_1.orders.cancelReasonType} = 'restaurant')`));
    const userOrderCount = Number(orderCountRow?.cnt ?? 0);
    // 3. Filter to eligible discounts and calculate each discount amount
    let bestResult = null;
    for (const discount of candidates) {
        // a) Global campaign usage limit (if set by restaurant)
        if (discount.maxUsage !== null && (discount.usedCount ?? 0) >= discount.maxUsage)
            continue;
        // b) User qualifies as long as their completed/active orders at this restaurant < firstOrderCount
        // (i.e. this is one of their first N orders at this specific restaurant)
        if (userOrderCount >= discount.firstOrderCount)
            continue;
        // c) Compute discount amount
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
