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
const resolveFirstOrderDiscount = async (userId, restaurantId, subtotal, orderSource) => {
    const now = new Date();
    // Channel matching: resolve target channels based on orderSource ("pos", "online_order_app", "online_order_web", etc.)
    const src = String(orderSource || "").trim().toLowerCase();
    const targetChannels = ["all"];
    if (src === "pos") {
        targetChannels.push("pos");
    }
    else if (src.includes("web") || src === "food_aggregator" || src === "mykeeto") {
        targetChannels.push("web");
    }
    else if (src.includes("app")) {
        targetChannels.push("app");
    }
    else {
        // Fallback if unspecified: allow both app and web
        targetChannels.push("app", "web");
    }
    // 1. Fetch all active discounts for this restaurant within the date window & channel
    const candidates = await connection_1.db
        .select()
        .from(schema_1.firstOrderDiscounts)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.firstOrderDiscounts.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.firstOrderDiscounts.status, "active"), (0, drizzle_orm_1.inArray)(schema_1.firstOrderDiscounts.channel, targetChannels), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.firstOrderDiscounts.startDate), (0, drizzle_orm_1.lte)(schema_1.firstOrderDiscounts.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.firstOrderDiscounts.endDate), (0, drizzle_orm_1.gte)(schema_1.firstOrderDiscounts.endDate, now))));
    if (candidates.length === 0)
        return null;
    // 2. Anti-fraud check: resolve all user accounts linked to this deviceId
    const [currentUser] = await connection_1.db
        .select({ deviceId: schema_1.users.deviceId })
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId))
        .limit(1);
    let userIdsToCheck = [userId];
    if (currentUser?.deviceId && currentUser.deviceId.trim()) {
        const sameDeviceUsers = await connection_1.db
            .select({ id: schema_1.users.id })
            .from(schema_1.users)
            .where((0, drizzle_orm_1.eq)(schema_1.users.deviceId, currentUser.deviceId.trim()));
        if (sameDeviceUsers.length > 0) {
            userIdsToCheck = Array.from(new Set([userId, ...sameDeviceUsers.map(u => u.id)]));
        }
    }
    // 3. Count total completed/active orders across all accounts sharing this deviceId at this restaurant
    const userCondition = userIdsToCheck.length === 1
        ? (0, drizzle_orm_1.eq)(schema_1.orders.userId, userIdsToCheck[0])
        : (0, drizzle_orm_1.inArray)(schema_1.orders.userId, userIdsToCheck);
    const [orderCountRow] = await connection_1.db
        .select({ cnt: (0, drizzle_orm_1.count)(schema_1.orders.id) })
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.and)(userCondition, (0, drizzle_orm_1.eq)(schema_1.orders.restaurantId, restaurantId), 
    // Exclude failed orders, pending visa payments, and orders cancelled by restaurant
    (0, drizzle_orm_1.ne)(schema_1.orders.status, 'failed'), (0, drizzle_orm_1.sql) `NOT (${schema_1.orders.paymentStatus} = 'pending_payment' AND ${schema_1.orders.status} = 'pending')`, (0, drizzle_orm_1.sql) `NOT (${schema_1.orders.status} = 'cancelled' AND ${schema_1.orders.cancelReasonType} = 'restaurant')`));
    const userOrderCount = Number(orderCountRow?.cnt ?? 0);
    // 4. Filter to eligible discounts and calculate each discount amount
    let bestResult = null;
    for (const discount of candidates) {
        // a) Global campaign usage limit (if set by restaurant)
        if (discount.maxUsage !== null && (discount.usedCount ?? 0) >= discount.maxUsage)
            continue;
        // b) User qualifies as long as their completed/active orders on this device at this restaurant < firstOrderCount
        if (userOrderCount >= discount.firstOrderCount)
            continue;
        // c) Check per-user usage cap across all accounts on this device (if set)
        if (discount.maxUsagePerUser !== null) {
            const usageCondition = userIdsToCheck.length === 1
                ? (0, drizzle_orm_1.eq)(schema_1.firstOrderDiscountUsages.userId, userIdsToCheck[0])
                : (0, drizzle_orm_1.inArray)(schema_1.firstOrderDiscountUsages.userId, userIdsToCheck);
            const [usageCountRow] = await connection_1.db
                .select({ cnt: (0, drizzle_orm_1.count)(schema_1.firstOrderDiscountUsages.id) })
                .from(schema_1.firstOrderDiscountUsages)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.firstOrderDiscountUsages.firstOrderDiscountId, discount.id), usageCondition));
            const deviceUsageCount = Number(usageCountRow?.cnt ?? 0);
            if (deviceUsageCount >= discount.maxUsagePerUser)
                continue;
        }
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
