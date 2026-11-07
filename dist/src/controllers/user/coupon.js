"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailableCoupons = exports.checkCoupon = void 0;
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const userBlockCheck_1 = require("../../utils/userBlockCheck");
const coupon_helper_1 = require("../../helpers/coupon.helper");
/**
 * 1. Validate / Check Coupon
 * POST /api/coupon/check
 *
 * Checks coupon validity in real-time, calculates discount, and returns
 * full pricing summary (subtotal, discount, delivery fee, final total).
 */
const checkCoupon = async (req, res) => {
    const userId = req.user?.id;
    const { code, restaurantId, subtotal: reqSubtotal, deliveryFee: reqDeliveryFee = 0, orderType = "delivery", foodIds: reqFoodIds, foods: reqFoods, items: reqItems, cartItems: reqCartItems, } = req.body;
    if (!code || !code.trim()) {
        throw new BadRequest_1.BadRequest("Coupon code is required.");
    }
    if (!restaurantId) {
        throw new BadRequest_1.BadRequest("restaurantId is required.");
    }
    // 🛡️ Block check
    await (0, userBlockCheck_1.validateUserNotBlocked)(userId, restaurantId);
    // Resolve subtotal (from body if provided, or from user's current cart items)
    let subtotal = typeof reqSubtotal === "number" ? reqSubtotal : parseFloat(reqSubtotal || "0");
    const rawFoodIds = reqFoodIds !== undefined ? reqFoodIds : reqFoods;
    let cartFoodIds = Array.isArray(rawFoodIds) && rawFoodIds.length > 0
        ? rawFoodIds.map(String).filter(Boolean)
        : undefined;
    const rawItems = reqItems || reqCartItems;
    let cartItemsData = undefined;
    if (Array.isArray(rawItems) && rawItems.length > 0) {
        cartItemsData = rawItems
            .map((item) => ({
            foodId: item.foodId || item.id,
            totalPrice: typeof item.totalPrice === "number" ? item.totalPrice : parseFloat(item.totalPrice || item.price || "0"),
        }))
            .filter((i) => Boolean(i.foodId));
    }
    if (!cartItemsData || cartItemsData.length === 0) {
        cartItemsData = await (0, coupon_helper_1.getCartItemsWithDiscounts)(userId, restaurantId);
    }
    if (!subtotal || subtotal <= 0) {
        subtotal = cartItemsData.reduce((sum, item) => sum + item.totalPrice, 0);
    }
    if (!cartFoodIds) {
        cartFoodIds = cartItemsData.map((item) => item.foodId).filter(Boolean);
    }
    const deliveryFee = typeof reqDeliveryFee === "number" ? reqDeliveryFee : parseFloat(reqDeliveryFee || "0");
    // Validate coupon and compute discount
    const { coupon, discountAmount, isFreeDelivery, eligibleFoods, eligibleSubtotal } = await (0, coupon_helper_1.validateAndCalculateCoupon)(code, userId, restaurantId, subtotal, deliveryFee, cartFoodIds, cartItemsData);
    const finalDeliveryFee = isFreeDelivery ? 0 : deliveryFee;
    let finalTotal = Math.max(0, subtotal + finalDeliveryFee - (isFreeDelivery ? 0 : discountAmount));
    finalTotal = Math.round(finalTotal * 100) / 100;
    return (0, response_1.SuccessResponse)(res, {
        message: "Coupon is valid and applied successfully.",
        data: {
            couponId: coupon.id,
            code: coupon.code,
            name: coupon.name,
            nameAr: coupon.nameAr,
            nameFr: coupon.nameFr,
            discountType: coupon.discountType,
            discountValue: parseFloat(coupon.discountValue || "0"),
            maxDiscount: coupon.maxDiscount ? parseFloat(coupon.maxDiscount || "0") : null,
            minOrderAmount: parseFloat(coupon.minOrderAmount || "0"),
            foods: eligibleFoods,
            eligibleSubtotal,
            discountAmount,
            isFreeDelivery,
            summary: {
                subtotal: Math.round(subtotal * 100) / 100,
                eligibleSubtotal: eligibleSubtotal !== null ? Math.round(eligibleSubtotal * 100) / 100 : null,
                deliveryFee: Math.round(deliveryFee * 100) / 100,
                effectiveDeliveryFee: Math.round(finalDeliveryFee * 100) / 100,
                discountAmount,
                finalTotal,
                currency: "EGP",
            },
        },
    });
};
exports.checkCoupon = checkCoupon;
/**
 * 2. Get Available Coupons for User
 * GET /api/coupon/available?restaurantId=...
 *
 * Lists all active coupons that the user is currently eligible to use.
 */
const getAvailableCoupons = async (req, res) => {
    const userId = req.user?.id;
    const restaurantId = req.query?.restaurantId;
    if (!restaurantId) {
        throw new BadRequest_1.BadRequest("restaurantId query parameter is required.");
    }
    // 🛡️ Block check
    await (0, userBlockCheck_1.validateUserNotBlocked)(userId, restaurantId);
    const availableCoupons = await (0, coupon_helper_1.getAvailableCouponsForUser)(userId, restaurantId);
    return (0, response_1.SuccessResponse)(res, {
        message: "Available coupons fetched successfully.",
        data: availableCoupons,
    });
};
exports.getAvailableCoupons = getAvailableCoupons;
