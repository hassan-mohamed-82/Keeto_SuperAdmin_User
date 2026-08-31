"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAvailableCoupons = exports.checkCoupon = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
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
    const { code, restaurantId, subtotal: reqSubtotal, deliveryFee: reqDeliveryFee = 0, orderType = "delivery", } = req.body;
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
    if (!subtotal || subtotal <= 0) {
        const userCart = await connection_1.db
            .select()
            .from(schema_1.cartItems)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, restaurantId)));
        if (userCart.length > 0) {
            subtotal = userCart.reduce((sum, item) => {
                return sum + parseFloat(item.totalPrice || "0");
            }, 0);
        }
    }
    const deliveryFee = typeof reqDeliveryFee === "number" ? reqDeliveryFee : parseFloat(reqDeliveryFee || "0");
    // Validate coupon and compute discount
    const { coupon, discountAmount, isFreeDelivery } = await (0, coupon_helper_1.validateAndCalculateCoupon)(code, userId, restaurantId, subtotal, deliveryFee);
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
            discountAmount,
            isFreeDelivery,
            summary: {
                subtotal: Math.round(subtotal * 100) / 100,
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
    const { restaurantId } = req.query;
    if (!restaurantId || typeof restaurantId !== "string") {
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
