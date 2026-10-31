// src/helpers/coupon.helper.ts
import { db } from "../models/connection";
import {
    coupons,
    couponUsages,
    couponRestaurants,
    cartItems,
    food,
} from "../models/schema";
import { eq, and, sql, or, isNull, lte, gte, inArray } from "drizzle-orm";
import { BadRequest } from "../Errors/BadRequest";
import { formatProductsWithDiscounts } from "../services/discount.service";
import { NotFound } from "../Errors/NotFound";

export type EligibleFood = {
    id: string;
    name: string;
    nameAr: string | null;
    nameFr: string | null;
};

export type CouponValidationResult = {
    coupon: typeof coupons.$inferSelect;
    discountAmount: number;
    isFreeDelivery: boolean;
    eligibleFoods: EligibleFood[] | null;
    eligibleSubtotal: number | null; // subtotal of only the coupon-eligible foods (null = applies to full cart)
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
 *  7. Food-level restriction (if foodIds is configured, cart must contain at least one eligible food)
 */
/**
 * Fetches user cart items for a restaurant with live product-level discounts applied.
 */
export const getCartItemsWithDiscounts = async (
    userId: string,
    restaurantId: string
): Promise<{ foodId: string; totalPrice: number }[]> => {
    const userCart = await db
        .select({
            foodId: cartItems.foodId,
            quantity: cartItems.quantity,
            unitPrice: cartItems.unitPrice,
            totalPrice: cartItems.totalPrice,
            foodPrice: food.price,
            discountId: food.discountId,
            discount_type: food.discount_type,
            discount_value: food.discount_value,
        })
        .from(cartItems)
        .leftJoin(food, eq(cartItems.foodId, food.id))
        .where(
            and(
                eq(cartItems.userId, userId),
                eq(cartItems.restaurantId, restaurantId)
            )
        );

    if (userCart.length === 0) return [];

    const resolvedDiscounts = await formatProductsWithDiscounts(
        userCart.map((i) => ({
            id: i.foodId,
            price: i.foodPrice,
            discountId: i.discountId,
            discount_type: i.discount_type,
            discount_value: i.discount_value,
        })),
        restaurantId
    );

    const discountMap = new Map(resolvedDiscounts.map((d) => [d.id, d.discountAmount]));

    return userCart.map((item) => {
        const discountPerUnit = discountMap.get(item.foodId) || 0;
        const originalUnit = parseFloat((item.unitPrice as string) || "0");
        const finalUnit = Math.max(0, originalUnit - discountPerUnit);
        const finalTotal = Math.round(finalUnit * item.quantity * 100) / 100;

        return {
            foodId: item.foodId,
            totalPrice: finalTotal,
        };
    });
};

export const validateAndCalculateCoupon = async (
    couponCode: string,
    userId: string,
    restaurantId: string,
    subtotal: number,
    deliveryFee: number = 0,
    cartFoodIds?: string[],
    cartItemsData?: { foodId: string; totalPrice: number }[]
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
    // 'unlimited' → skip this check entirely — user can use it as many times as they want
    // 'fixed'     → enforce perUserLimit
    if (coupon.userUsageType === "fixed") {
        const userLimit = coupon.perUserLimit ?? 1;

        const [usageCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(couponUsages)
            .where(
                and(
                    eq(couponUsages.couponId, coupon.id),
                    eq(couponUsages.userId, userId)
                )
            );

        if (Number(usageCount?.count || 0) >= userLimit) {
            throw new BadRequest(
                `You have reached the maximum usage limit (${userLimit} time(s)) for this coupon.`
            );
        }
    }
    // userUsageType === 'unlimited' → no per-user check needed

    // 6. Minimum order amount check
    const minRequired = parseFloat((coupon.minOrderAmount as string) || "0");
    if (minRequired > 0 && subtotal < minRequired) {
        throw new BadRequest(
            `Minimum order amount of ${minRequired.toFixed(2)} EGP is required to apply this coupon.`
        );
    }

    // 7. Food-level restriction check
    // If foodIds is null, undefined, or empty, the coupon applies to the cart without checking food items.
    // If foodIds is specified, the coupon ONLY applies if at least one of these foods exists in the cart.
    // foodIds may be stored as a JSON string in the DB, so we parse it if needed.
    let eligibleFoodIds: string[] | null = null;
    if (coupon.foodIds) {
        if (Array.isArray(coupon.foodIds)) {
            eligibleFoodIds = coupon.foodIds as string[];
        } else if (typeof coupon.foodIds === "string") {
            try {
                const parsed = JSON.parse(coupon.foodIds);
                eligibleFoodIds = Array.isArray(parsed) ? parsed : null;
            } catch {
                eligibleFoodIds = null;
            }
        }
    }

    let eligibleFoods: EligibleFood[] | null = null;
    let eligibleSubtotal: number | null = null;
    if (eligibleFoodIds && eligibleFoodIds.length > 0) {
        let currentCartItems = cartItemsData;

        if (!currentCartItems || currentCartItems.length === 0) {
            currentCartItems = await getCartItemsWithDiscounts(userId, restaurantId);
        }

        const eligibleCartItems = currentCartItems.filter((item) =>
            eligibleFoodIds!.includes(item.foodId)
        );

        if (eligibleCartItems.length === 0) {
            throw new BadRequest("This coupon is only valid for specific items that are not in your cart.");
        }

        eligibleSubtotal = eligibleCartItems.reduce((sum, item) => sum + item.totalPrice, 0);
        eligibleSubtotal = Math.round(eligibleSubtotal * 100) / 100;

        // Fetch food details for the eligible food IDs
        const foodRows = await db
            .select({ id: food.id, name: food.name, nameAr: food.nameAr, nameFr: food.nameFr })
            .from(food)
            .where(inArray(food.id, eligibleFoodIds));
        eligibleFoods = foodRows.map((f) => ({
            id: f.id,
            name: f.name,
            nameAr: f.nameAr ?? null,
            nameFr: f.nameFr ?? null,
        }));
    }

    // 8. Calculate Discount Amount
    // When the coupon is restricted to specific foods, discount is applied ONLY on those foods' subtotal.
    // This prevents users from gaming the system by adding one cheap eligible item to get discount on everything.
    const discountBase = eligibleSubtotal !== null ? eligibleSubtotal : subtotal;

    let discountAmount = 0;
    let isFreeDelivery = false;
    const value = parseFloat((coupon.discountValue as string) || "0");

    if (coupon.discountType === "free_delivery") {
        isFreeDelivery = true;
        discountAmount = Math.max(0, deliveryFee);
    } else if (coupon.discountType === "fixed_amount") {
        discountAmount = Math.min(value, discountBase);
    } else if (coupon.discountType === "percentage") {
        let pDiscount = discountBase * (value / 100);
        if (coupon.maxDiscount) {
            const max = parseFloat((coupon.maxDiscount as string) || "0");
            if (max > 0 && pDiscount > max) {
                pDiscount = max;
            }
        }
        discountAmount = Math.min(pDiscount, discountBase);
    }

    discountAmount = Math.round(discountAmount * 100) / 100;

    return {
        coupon,
        discountAmount,
        isFreeDelivery,
        eligibleFoods,
        eligibleSubtotal,
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
            userUsageType: coupons.userUsageType,   // 'fixed' | 'unlimited'
            perUserLimit: coupons.perUserLimit,     // only enforced when userUsageType = 'fixed'
            startDate: coupons.startDate,
            endDate: coupons.endDate,
            isGlobal: coupons.isGlobal,
            foodIds: coupons.foodIds,
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
        // Global usage limit check (applies regardless of userUsageType)
        if (c.usageLimit && (c.usedCount ?? 0) >= c.usageLimit) continue;

        const userUsed = userUsagesMap.get(c.id) || 0;

        // Per-user limit check:
        // 'unlimited' → user can use it any number of times, skip this check
        // 'fixed'     → enforce perUserLimit (default 1 if not set)
        if (c.userUsageType === "fixed") {
            const userLimit = c.perUserLimit ?? 1;
            if (userUsed >= userLimit) continue;
        }
        // userUsageType === 'unlimited' → always available regardless of how many times used

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
            userUsageType: c.userUsageType,
            perUserLimit: c.userUsageType === "fixed" ? (c.perUserLimit ?? 1) : null,
            // null = unlimited; number = max times this user can use it
            remainingUserUsages: c.userUsageType === "fixed"
                ? (c.perUserLimit ?? 1) - userUsed
                : null,
            foodIds: c.foodIds,
        });
    }

    return availableCoupons;
};