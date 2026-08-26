// src/controllers/user/coupon.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cartItems } from "../../models/schema";
import { eq, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { validateUserNotBlocked } from "../../utils/userBlockCheck";
import {
    validateAndCalculateCoupon,
    getAvailableCouponsForUser,
} from "../../helpers/coupon.helper";

/**
 * 1. Validate / Check Coupon
 * POST /api/coupon/check
 *
 * Checks coupon validity in real-time, calculates discount, and returns
 * full pricing summary (subtotal, discount, delivery fee, final total).
 */
export const checkCoupon = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const {
        code,
        restaurantId,
        subtotal: reqSubtotal,
        deliveryFee: reqDeliveryFee = 0,
        orderType = "delivery",
    } = req.body;

    if (!code || !code.trim()) {
        throw new BadRequest("Coupon code is required.");
    }
    if (!restaurantId) {
        throw new BadRequest("restaurantId is required.");
    }

    // 🛡️ Block check
    await validateUserNotBlocked(userId, restaurantId);

    // Resolve subtotal (from body if provided, or from user's current cart items)
    let subtotal = typeof reqSubtotal === "number" ? reqSubtotal : parseFloat(reqSubtotal || "0");

    if (!subtotal || subtotal <= 0) {
        const userCart = await db
            .select()
            .from(cartItems)
            .where(
                and(
                    eq(cartItems.userId, userId),
                    eq(cartItems.restaurantId, restaurantId)
                )
            );

        if (userCart.length > 0) {
            subtotal = userCart.reduce((sum, item) => {
                return sum + parseFloat(item.totalPrice as string || "0");
            }, 0);
        }
    }

    const deliveryFee = typeof reqDeliveryFee === "number" ? reqDeliveryFee : parseFloat(reqDeliveryFee || "0");

    // Validate coupon and compute discount
    const { coupon, discountAmount, isFreeDelivery } = await validateAndCalculateCoupon(
        code,
        userId,
        restaurantId,
        subtotal,
        deliveryFee
    );

    const finalDeliveryFee = isFreeDelivery ? 0 : deliveryFee;
    let finalTotal = Math.max(0, subtotal + finalDeliveryFee - (isFreeDelivery ? 0 : discountAmount));
    finalTotal = Math.round(finalTotal * 100) / 100;

    return SuccessResponse(res, {
        message: "Coupon is valid and applied successfully.",
        data: {
            couponId: coupon.id,
            code: coupon.code,
            name: coupon.name,
            nameAr: coupon.nameAr,
            nameFr: coupon.nameFr,
            discountType: coupon.discountType,
            discountValue: parseFloat((coupon.discountValue as string) || "0"),
            maxDiscount: coupon.maxDiscount ? parseFloat((coupon.maxDiscount as string) || "0") : null,
            minOrderAmount: parseFloat((coupon.minOrderAmount as string) || "0"),
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

/**
 * 2. Get Available Coupons for User
 * GET /api/coupon/available?restaurantId=...
 *
 * Lists all active coupons that the user is currently eligible to use.
 */
export const getAvailableCoupons = async (req: Request | any, res: Response) => {
    const userId = req.user?.id;
    const { restaurantId } = req.query;

    if (!restaurantId || typeof restaurantId !== "string") {
        throw new BadRequest("restaurantId query parameter is required.");
    }

    // 🛡️ Block check
    await validateUserNotBlocked(userId, restaurantId);

    const availableCoupons = await getAvailableCouponsForUser(userId, restaurantId);

    return SuccessResponse(res, {
        message: "Available coupons fetched successfully.",
        data: availableCoupons,
    });
};
