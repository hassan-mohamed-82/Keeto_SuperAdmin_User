"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailableCouponsForUser = exports.validateAndCalculateCoupon = void 0;
// src/helpers/coupon.helper.ts
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const BadRequest_1 = require("../Errors/BadRequest");
const NotFound_1 = require("../Errors/NotFound");
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
const validateAndCalculateCoupon = async (couponCode, userId, restaurantId, subtotal, deliveryFee = 0) => {
    if (!couponCode || !couponCode.trim()) {
        throw new BadRequest_1.BadRequest("Coupon code is required.");
    }
    const cleanCode = couponCode.trim();
    // 1. Fetch coupon by code (case-insensitive query via SQL collation or upper match)
    const [coupon] = await connection_1.db
        .select()
        .from(schema_1.coupons)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `LOWER(${schema_1.coupons.code}) = LOWER(${cleanCode})`, (0, drizzle_orm_1.eq)(schema_1.coupons.isActive, true)))
        .limit(1);
    if (!coupon) {
        throw new NotFound_1.NotFound("Invalid or inactive coupon code.");
    }
    const now = new Date();
    // 2. Date checks
    if (coupon.startDate && new Date(coupon.startDate) > now) {
        throw new BadRequest_1.BadRequest("This coupon is not active yet.");
    }
    if (coupon.endDate && new Date(coupon.endDate) < now) {
        throw new BadRequest_1.BadRequest("This coupon has expired.");
    }
    // 3. Global usage limit
    if (coupon.usageLimit && (coupon.usedCount ?? 0) >= coupon.usageLimit) {
        throw new BadRequest_1.BadRequest("This coupon has reached its maximum global usage limit.");
    }
    // 4. Restaurant scope check
    if (!coupon.isGlobal) {
        const [linkedRest] = await connection_1.db
            .select()
            .from(schema_1.couponRestaurants)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.couponRestaurants.couponId, coupon.id), (0, drizzle_orm_1.eq)(schema_1.couponRestaurants.restaurantId, restaurantId)))
            .limit(1);
        if (!linkedRest) {
            throw new BadRequest_1.BadRequest("This coupon is not applicable to this restaurant.");
        }
    }
    // 5. Per-user usage limit
    // 'unlimited' → skip this check entirely — user can use it as many times as they want
    // 'fixed'     → enforce perUserLimit
    if (coupon.userUsageType === "fixed") {
        const userLimit = coupon.perUserLimit ?? 1;
        const [usageCount] = await connection_1.db
            .select({ count: (0, drizzle_orm_1.sql) `count(*)` })
            .from(schema_1.couponUsages)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.couponUsages.couponId, coupon.id), (0, drizzle_orm_1.eq)(schema_1.couponUsages.userId, userId)));
        if (Number(usageCount?.count || 0) >= userLimit) {
            throw new BadRequest_1.BadRequest(`You have reached the maximum usage limit (${userLimit} time(s)) for this coupon.`);
        }
    }
    // userUsageType === 'unlimited' → no per-user check needed
    // 6. Minimum order amount check
    const minRequired = parseFloat(coupon.minOrderAmount || "0");
    if (minRequired > 0 && subtotal < minRequired) {
        throw new BadRequest_1.BadRequest(`Minimum order amount of ${minRequired.toFixed(2)} EGP is required to apply this coupon.`);
    }
    // 7. Calculate Discount Amount
    let discountAmount = 0;
    let isFreeDelivery = false;
    const value = parseFloat(coupon.discountValue || "0");
    if (coupon.discountType === "free_delivery") {
        isFreeDelivery = true;
        discountAmount = Math.max(0, deliveryFee);
    }
    else if (coupon.discountType === "fixed_amount") {
        discountAmount = Math.min(value, subtotal);
    }
    else if (coupon.discountType === "percentage") {
        let pDiscount = subtotal * (value / 100);
        if (coupon.maxDiscount) {
            const max = parseFloat(coupon.maxDiscount || "0");
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
exports.validateAndCalculateCoupon = validateAndCalculateCoupon;
/**
 * Returns all valid active coupons available for the specified user and restaurant.
 */
const getAvailableCouponsForUser = async (userId, restaurantId) => {
    const now = new Date();
    // 1. Fetch active coupons within date window (global OR restaurant-specific)
    const activeCoupons = await connection_1.db
        .select({
        id: schema_1.coupons.id,
        code: schema_1.coupons.code,
        name: schema_1.coupons.name,
        nameAr: schema_1.coupons.nameAr,
        nameFr: schema_1.coupons.nameFr,
        discountType: schema_1.coupons.discountType,
        discountValue: schema_1.coupons.discountValue,
        maxDiscount: schema_1.coupons.maxDiscount,
        minOrderAmount: schema_1.coupons.minOrderAmount,
        usageLimit: schema_1.coupons.usageLimit,
        usedCount: schema_1.coupons.usedCount,
        userUsageType: schema_1.coupons.userUsageType, // 'fixed' | 'unlimited'
        perUserLimit: schema_1.coupons.perUserLimit, // only enforced when userUsageType = 'fixed'
        startDate: schema_1.coupons.startDate,
        endDate: schema_1.coupons.endDate,
        isGlobal: schema_1.coupons.isGlobal,
    })
        .from(schema_1.coupons)
        .leftJoin(schema_1.couponRestaurants, (0, drizzle_orm_1.eq)(schema_1.coupons.id, schema_1.couponRestaurants.couponId))
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.coupons.isActive, true), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.coupons.startDate), (0, drizzle_orm_1.lte)(schema_1.coupons.startDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.isNull)(schema_1.coupons.endDate), (0, drizzle_orm_1.gte)(schema_1.coupons.endDate, now)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.coupons.isGlobal, true), (0, drizzle_orm_1.eq)(schema_1.couponRestaurants.restaurantId, restaurantId))));
    // Dedup coupons (in case multiple joins return duplicates)
    const uniqueCouponsMap = new Map();
    for (const c of activeCoupons) {
        uniqueCouponsMap.set(c.id, c);
    }
    // 2. Fetch user's usage counts for these coupons
    const couponIds = Array.from(uniqueCouponsMap.keys());
    const userUsagesMap = new Map();
    if (couponIds.length > 0) {
        const usages = await connection_1.db
            .select({
            couponId: schema_1.couponUsages.couponId,
            count: (0, drizzle_orm_1.sql) `count(*)`,
        })
            .from(schema_1.couponUsages)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.couponUsages.userId, userId), (0, drizzle_orm_1.inArray)(schema_1.couponUsages.couponId, couponIds)))
            .groupBy(schema_1.couponUsages.couponId);
        usages.forEach((u) => userUsagesMap.set(u.couponId, Number(u.count || 0)));
    }
    // 3. Filter out exhausted coupons
    const availableCoupons = [];
    for (const c of uniqueCouponsMap.values()) {
        // Global usage limit check (applies regardless of userUsageType)
        if (c.usageLimit && (c.usedCount ?? 0) >= c.usageLimit)
            continue;
        const userUsed = userUsagesMap.get(c.id) || 0;
        // Per-user limit check:
        // 'unlimited' → user can use it any number of times, skip this check
        // 'fixed'     → enforce perUserLimit (default 1 if not set)
        if (c.userUsageType === "fixed") {
            const userLimit = c.perUserLimit ?? 1;
            if (userUsed >= userLimit)
                continue;
        }
        // userUsageType === 'unlimited' → always available regardless of how many times used
        availableCoupons.push({
            id: c.id,
            code: c.code,
            name: c.name,
            nameAr: c.nameAr,
            nameFr: c.nameFr,
            discountType: c.discountType,
            discountValue: parseFloat(c.discountValue || "0"),
            maxDiscount: c.maxDiscount ? parseFloat(c.maxDiscount || "0") : null,
            minOrderAmount: parseFloat(c.minOrderAmount || "0"),
            endDate: c.endDate,
            userUsageType: c.userUsageType,
            perUserLimit: c.userUsageType === "fixed" ? (c.perUserLimit ?? 1) : null,
            // null = unlimited; number = max times this user can use it
            remainingUserUsages: c.userUsageType === "fixed"
                ? (c.perUserLimit ?? 1) - userUsed
                : null,
        });
    }
    return availableCoupons;
};
exports.getAvailableCouponsForUser = getAvailableCouponsForUser;
