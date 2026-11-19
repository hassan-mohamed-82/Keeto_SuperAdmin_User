import { validateAndCalculateCoupon } from "../../helpers/coupon.helper";
import { resolveFirstOrderDiscount } from "../../helpers/firstOrderDiscount.helper";
import { roundMoney, DiscountResolutionResult } from "./checkout.types";

/**
 * Calculates discounts (food-level, first order discount, and coupon).
 */
export const resolveDiscounts = async (params: {
    subtotal: number;
    initialSubtotal: number;
    hasFoodLevelDiscount: boolean;
    resolvedOrderProducts: any[];
    appliedDiscountIds: Set<string>;
    isGuestUser: boolean;
    userId: string;
    restaurantId: string;
    couponCode: string | undefined;
    itemsToInsert: any[];
}): Promise<DiscountResolutionResult> => {
    const {
        subtotal,
        initialSubtotal,
        hasFoodLevelDiscount,
        resolvedOrderProducts,
        appliedDiscountIds,
        isGuestUser,
        userId,
        restaurantId,
        couponCode,
        itemsToInsert,
    } = params;

    let totalDiscount = 0;
    let appliedCoupon: any = null;
    let isFreeDelivery = false;

    let orderDiscountId: string | null = null;
    let orderCouponId: string | null = null;
    let orderDiscountType: "percentage" | "fixed_amount" | null = null;
    let orderDiscountValue: string | null = null;
    let orderDiscountSource:
        | "food_level"
        | "restaurant_discount"
        | "global_discount"
        | "coupon"
        | "first_order_discount"
        | null = null;

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
    } else if (hasFoodLevelDiscount) {
        orderDiscountSource = "food_level";
        orderDiscountValue = roundMoney(initialSubtotal - subtotal).toFixed(2);
    }

    // First Orders Discount
    let appliedFirstOrderDiscount: any = null;
    let firstOrderDiscountAmount = 0;
    let orderFirstOrderDiscountId: string | null = null;

    const existingProductDiscountAmount = roundMoney(Math.max(0, initialSubtotal - subtotal));

    if (!isGuestUser) {
        const eligibleFirstOrder = await resolveFirstOrderDiscount(
            userId,
            restaurantId,
            initialSubtotal > 0 ? initialSubtotal : subtotal
        );

        if (eligibleFirstOrder) {
            firstOrderDiscountAmount = eligibleFirstOrder.discountAmount;
            appliedFirstOrderDiscount = eligibleFirstOrder.discount;
        }
    }

    if (appliedFirstOrderDiscount && firstOrderDiscountAmount > existingProductDiscountAmount) {
        const additionalDiscount = roundMoney(firstOrderDiscountAmount - existingProductDiscountAmount);
        totalDiscount += additionalDiscount;
        orderFirstOrderDiscountId = appliedFirstOrderDiscount.id;
        orderDiscountSource = "first_order_discount";
        orderDiscountType =
            appliedFirstOrderDiscount.discountType === "percentage" ? "percentage" : "fixed_amount";
        orderDiscountValue = appliedFirstOrderDiscount.discountValue
            ? String(appliedFirstOrderDiscount.discountValue)
            : String(firstOrderDiscountAmount);
    } else {
        appliedFirstOrderDiscount = null;
    }

    // Coupon calculation
    if (couponCode) {
        const couponResult = await validateAndCalculateCoupon(
            couponCode,
            userId,
            restaurantId,
            subtotal,
            0,
            itemsToInsert.map((c) => c.foodId).filter(Boolean) as string[],
            itemsToInsert.map((c) => ({
                foodId: c.foodId,
                totalPrice: parseFloat(c.totalPrice || "0"),
            }))
        );

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

    totalDiscount = roundMoney(totalDiscount);

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
