// src/helpers/coupon.helper.ts
import { db } from "../models/connection";
import {
    coupons,
    couponUsages,
    couponRestaurants,
} from "../models/schema";
import { eq, and, sql, or, isNull, lte, gte, inArray } from "drizzle-orm";
import { BadRequest } from "../Errors/BadRequest";
import { NotFound } from "../Errors/NotFound";

export type CouponValidationResult = {
    coupon: typeof coupons.$inferSelect;
    discountAmount: number;
    isFreeDelivery: boolean;
};

/**
 * Validates a coupon code against business rules and computes the discount amount.
 * Used by both the check/validate endpoint and checkout process.
 *
 * Validation checks:
 *  1. Coupon exists & isActive === true
 *  2. Date validity (startDate <= now <= endDate)
 *  3. Global usage limit (usedCount < usageLimit)
 *  4. Per-user usage limit (user usages < perUserLimit)
 *  5. Restaurant eligibility (isGlobal === true OR linked in couponRestaurants)
 *  6. Minimum order subtotal requirement
 */
export const validateAndCalculateCoupon = async (
    couponCode: string,
    userId: string,
    restaurantId: string,
    subtotal: number,
    deliveryFee: number = 0
): Promise<CouponValidationResult> => {
    if (!couponCode || !couponCode.trim()) {
        throw new BadRequest("Coupon code is required.");
    }

    const cleanCode = couponCode.trim();

    // 1. Fetch coupon by code (case-insensitive query via SQL collation or upper match)
    const [coupon] = await db
        .select()
        .from(coupons)
        .where(
            and(
                sql`LOWER(${coupons.code}) = LOWER(${cleanCode})`,
                eq(coupons.isActive, true)
            )
        )
        .limit(1);

    if (!coupon) {
        throw new NotFound("Invalid or inactive coupon code.");
    }

    const now = new Date();

    // 2. Date checks
    if (coupon.startDate && new Date(coupon.startDate) > now) {
        throw new BadRequest("This coupon is not active yet.");
    }
    if (coupon.endDate && new Date(coupon.endDate) < now) {
        throw new BadRequest("This coupon has expired.");
    }

    // 3. Global usage limit
    if (coupon.usageLimit && (coupon.usedCount ?? 0) >= coupon.usageLimit) {
        throw new BadRequest("This coupon has reached its maximum global usage limit.");
    }

    // 4. Restaurant scope check
    if (!coupon.isGlobal) {
        const [linkedRest] = await db
            .select()
            .from(couponRestaurants)
            .where(
                and(
                    eq(couponRestaurants.couponId, coupon.id),
                    eq(couponRestaurants.restaurantId, restaurantId)
                )
            )
            .limit(1);

        if (!linkedRest) {
            throw new BadRequest("This coupon is not applicable to this restaurant.");
        }
    }

    // 5. Per-user usage limit
    if (coupon.perUserLimit) {
        const [usageCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(couponUsages)
            .where(
                and(
                    eq(couponUsages.couponId, coupon.id),
                    eq(couponUsages.userId, userId)
                )
            );

        if (Number(usageCount?.count || 0) >= coupon.perUserLimit) {
            throw new BadRequest(
                `You have reached the maximum usage limit (${coupon.perUserLimit} time(s)) for this coupon.`
            );
        }
    }

    // 6. Minimum order amount check
    const minRequired = parseFloat((coupon.minOrderAmount as string) || "0");
    if (minRequired > 0 && subtotal < minRequired) {
        throw new BadRequest(
            `Minimum order amount of ${minRequired.toFixed(2)} EGP is required to apply this coupon.`
        );
    }

    // 7. Calculate Discount Amount
    let discountAmount = 0;
    let isFreeDelivery = false;
    const value = parseFloat((coupon.discountValue as string) || "0");

    if (coupon.discountType === "free_delivery") {
        isFreeDelivery = true;
        discountAmount = Math.max(0, deliveryFee);
    } else if (coupon.discountType === "fixed_amount") {
        discountAmount = Math.min(value, subtotal);
    } else if (coupon.discountType === "percentage") {
        let pDiscount = subtotal * (value / 100);
        if (coupon.maxDiscount) {
            const max = parseFloat((coupon.maxDiscount as string) || "0");
            if (max > 0 && pDiscount > max) {
                pDiscount = max;
            }
        }
        discountAmount = Math.min(pDiscount, subtotal);
    }

    discountAmount = Math.round(discountAmount * 100) / 100;

    return {
        coupon,
        discountAmount,
        isFreeDelivery,
    };
};

/**
 * Returns all valid active coupons available for the specified user and restaurant.
 */
export const getAvailableCouponsForUser = async (
    userId: string,
    restaurantId: string
) => {
    const now = new Date();

    // 1. Fetch active coupons within date window (global OR restaurant-specific)
    const activeCoupons = await db
        .select({
            id: coupons.id,
            code: coupons.code,
            name: coupons.name,
            nameAr: coupons.nameAr,
            nameFr: coupons.nameFr,
            discountType: coupons.discountType,
            discountValue: coupons.discountValue,
            maxDiscount: coupons.maxDiscount,
            minOrderAmount: coupons.minOrderAmount,
            usageLimit: coupons.usageLimit,
            usedCount: coupons.usedCount,
            perUserLimit: coupons.perUserLimit,
            startDate: coupons.startDate,
            endDate: coupons.endDate,
            isGlobal: coupons.isGlobal,
        })
        .from(coupons)
        .leftJoin(couponRestaurants, eq(coupons.id, couponRestaurants.couponId))
        .where(
            and(
                eq(coupons.isActive, true),
                or(isNull(coupons.startDate), lte(coupons.startDate, now)),
                or(isNull(coupons.endDate), gte(coupons.endDate, now)),
                or(
                    eq(coupons.isGlobal, true),
                    eq(couponRestaurants.restaurantId, restaurantId)
                )
            )
        );

    // Dedup coupons (in case multiple joins return duplicates)
    const uniqueCouponsMap = new Map<string, (typeof activeCoupons)[number]>();
    for (const c of activeCoupons) {
        uniqueCouponsMap.set(c.id, c);
    }

    // 2. Fetch user's usage counts for these coupons
    const couponIds = Array.from(uniqueCouponsMap.keys());
    const userUsagesMap = new Map<string, number>();

    if (couponIds.length > 0) {
        const usages = await db
            .select({
                couponId: couponUsages.couponId,
                count: sql<number>`count(*)`,
            })
            .from(couponUsages)
            .where(
                and(
                    eq(couponUsages.userId, userId),
                    inArray(couponUsages.couponId, couponIds)
                )
            )
            .groupBy(couponUsages.couponId);

        usages.forEach((u) => userUsagesMap.set(u.couponId, Number(u.count || 0)));
    }

    // 3. Filter out exhausted coupons
    const availableCoupons = [];
    for (const c of uniqueCouponsMap.values()) {
        // Global limit check
        if (c.usageLimit && (c.usedCount ?? 0) >= c.usageLimit) continue;

        // Per user limit check
        const userUsed = userUsagesMap.get(c.id) || 0;
        if (c.perUserLimit && userUsed >= c.perUserLimit) continue;

        availableCoupons.push({
            id: c.id,
            code: c.code,
            name: c.name,
            nameAr: c.nameAr,
            nameFr: c.nameFr,
            discountType: c.discountType,
            discountValue: parseFloat((c.discountValue as string) || "0"),
            maxDiscount: c.maxDiscount ? parseFloat((c.maxDiscount as string) || "0") : null,
            minOrderAmount: parseFloat((c.minOrderAmount as string) || "0"),
            endDate: c.endDate,
            remainingUserUsages: c.perUserLimit ? c.perUserLimit - userUsed : null,
        });
    }

    return availableCoupons;
};
