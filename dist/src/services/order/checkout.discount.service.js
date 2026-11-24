"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDiscounts = void 0;
const coupon_helper_1 = require("../../helpers/coupon.helper");
const firstOrderDiscount_helper_1 = require("../../helpers/firstOrderDiscount.helper");
const checkout_types_1 = require("./checkout.types");
/**
 * Calculates discounts (food-level, first order discount, and coupon).
 */
const resolveDiscounts = async (params) => {
    const { subtotal, initialSubtotal, hasFoodLevelDiscount, resolvedOrderProducts, appliedDiscountIds, isGuestUser, userId, restaurantId, couponCode, itemsToInsert, orderSource, } = params;
    let totalDiscount = 0;
    let appliedCoupon = null;
    let isFreeDelivery = false;
    let orderDiscountId = null;
    let orderCouponId = null;
    let orderDiscountType = null;
    let orderDiscountValue = null;
    let orderDiscountSource = null;
    const appliedProduct = resolvedOrderProducts.find((product) => product.discountAmount > 0);
    if (appliedProduct?.discountDetails) {
        orderDiscountId = appliedProduct.discountDetails.id;
        orderDiscountSource =
            appliedProduct.discountDetails.source === "product"
                ? "food_level"
                : appliedProduct.discountDetails.source === "global"
                    ? "global_discount"
                    : "restaurant_discount";
        orderDiscountType = appliedProduct.discountDetails.type === "percentage" ? "percentage" : "fixed_amount";
        orderDiscountValue = String(appliedProduct.discountDetails.value);
    }
    else if (hasFoodLevelDiscount) {
        orderDiscountSource = "food_level";
        orderDiscountValue = (0, checkout_types_1.roundMoney)(initialSubtotal - subtotal).toFixed(2);
    }
    // First Orders Discount
    let appliedFirstOrderDiscount = null;
    let firstOrderDiscountAmount = 0;
    let orderFirstOrderDiscountId = null;
    const existingProductDiscountAmount = (0, checkout_types_1.roundMoney)(Math.max(0, initialSubtotal - subtotal));
    if (!isGuestUser) {
        const eligibleFirstOrder = await (0, firstOrderDiscount_helper_1.resolveFirstOrderDiscount)(userId, restaurantId, initialSubtotal > 0 ? initialSubtotal : subtotal, orderSource);
        if (eligibleFirstOrder) {
            firstOrderDiscountAmount = eligibleFirstOrder.discountAmount;
            appliedFirstOrderDiscount = eligibleFirstOrder.discount;
        }
    }
    if (appliedFirstOrderDiscount && firstOrderDiscountAmount > existingProductDiscountAmount) {
        const additionalDiscount = (0, checkout_types_1.roundMoney)(firstOrderDiscountAmount - existingProductDiscountAmount);
        totalDiscount += additionalDiscount;
        orderFirstOrderDiscountId = appliedFirstOrderDiscount.id;
        orderDiscountSource = "first_order_discount";
        orderDiscountType =
            appliedFirstOrderDiscount.discountType === "percentage" ? "percentage" : "fixed_amount";
        orderDiscountValue = appliedFirstOrderDiscount.discountValue
            ? String(appliedFirstOrderDiscount.discountValue)
            : String(firstOrderDiscountAmount);
    }
    else {
        appliedFirstOrderDiscount = null;
    }
    // Coupon calculation
    if (couponCode) {
        const couponResult = await (0, coupon_helper_1.validateAndCalculateCoupon)(couponCode, userId, restaurantId, subtotal, 0, itemsToInsert.map((c) => c.foodId).filter(Boolean), itemsToInsert.map((c) => ({
            foodId: c.foodId,
            totalPrice: parseFloat(c.totalPrice || "0"),
        })));
        appliedCoupon = couponResult.coupon;
        const couponDiscountAmount = couponResult.discountAmount;
        isFreeDelivery = couponResult.isFreeDelivery;
        if (appliedCoupon) {
            orderCouponId = appliedCoupon.id || null;
            totalDiscount += couponDiscountAmount;
            if (!orderDiscountSource) {
                orderDiscountSource = "coupon";
                orderDiscountType = appliedCoupon.discountType === "percentage" ? "percentage" : "fixed_amount";
                orderDiscountValue = appliedCoupon.discountValue
                    ? appliedCoupon.discountValue.toString()
                    : couponDiscountAmount.toFixed(2);
            }
        }
    }
    totalDiscount = (0, checkout_types_1.roundMoney)(totalDiscount);
    return {
        totalDiscount,
        appliedCoupon,
        isFreeDelivery,
        orderDiscountId,
        orderCouponId,
        orderFirstOrderDiscountId,
        orderDiscountType,
        orderDiscountValue,
        orderDiscountSource,
        firstOrderDiscountAmount,
        appliedDiscountIds,
    };
};
exports.resolveDiscounts = resolveDiscounts;
