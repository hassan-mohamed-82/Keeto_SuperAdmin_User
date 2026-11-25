import { db } from "../../models/connection";
import {
    orders,
    orderItems,
    cartItems,
    users,
    addresses,
    userWallets,
    userWalletTransactions,
    notifications,
    couponUsages,
    coupons,
    discounts,
    userRestaurantPoints,
    weightRequests,
} from "../../models/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";
import { getNextDailyOrderNumber } from "../../helpers/getNextDailyOrderNumber";
import { chargePendingServiceFee } from "../restaurantWalletService";
import { recordFirstOrderDiscountUsage } from "../../helpers/firstOrderDiscount.helper";
import { sendPushNotification } from "../../utils/notifications";
import { roundMoney } from "./checkout.types";

/**
 * Executes the main order database transaction.
 */
export const executeOrderTransaction = async (params: {
    now: Date;
    hasWeightedItems: boolean;
    activeWeightRequest: any;
    weightClaimRequestId: string | null;
    assertWeightCartUnchanged: (tx: any, lockedRequestId: string) => Promise<void>;
    isGuestUser: boolean;
    guestName: string | null;
    guestPhone: string | null;
    guestAltPhone: string | null;
    pendingGuestAddress: any;
    isWalletPayment: boolean;
    isCashPayment: boolean;
    isVisaPayment: boolean;
    userId: string;
    totalAmount: number;
    orderNumber: string;
    restaurantId: string;
    settings: any;
    orderId: string;
    idempotencyKey?: string;
    resolvedBranchId: string | null;
    resolvedZoneId: string | null;
    addressId: string | null;
    storedOrderSource: string;
    paymentMethod: string;
    finalPaymentGatewayType: any;
    paymentSessionData: any;
    resolvedOrderType: "delivery" | "takeaway" | "dine_in";
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    appCommission: number;
    visaCommission: number;
    shippingAddressSnapshot: any;
    branchSnapshotData: any;
    orderDiscountId: string | null;
    orderCouponId: string | null;
    orderFirstOrderDiscountId: string | null;
    totalDiscount: number;
    orderDiscountType: any;
    orderDiscountValue: any;
    orderDiscountSource: any;
    couponCode?: string;
    note?: string;
    targetShippingCompanyId: string | null;
    defaultPreparingDuration: number;
    userCart: any[];
    itemsToInsert: any[];
    restaurant: any;
    appliedCoupon: any;
    calculatedDeliveryFee: number;
    firstOrderDiscountAmount: number;
    appliedDiscountIds: Set<string>;
    taxAmount?: number;
    includedTaxAmount?: number;
    taxDetails?: any[];
}): Promise<{ createdDailyOrderNumber: number }> => {
    const {
        now,
        hasWeightedItems,
        activeWeightRequest,
        weightClaimRequestId,
        assertWeightCartUnchanged,
        isGuestUser,
        guestName,
        guestPhone,
        guestAltPhone,
        pendingGuestAddress,
        isWalletPayment,
        isCashPayment,
        isVisaPayment,
        userId,
        totalAmount,
        orderNumber,
        restaurantId,
        settings,
        orderId,
        idempotencyKey,
        resolvedBranchId,
        resolvedZoneId,
        addressId,
        storedOrderSource,
        paymentMethod,
        finalPaymentGatewayType,
        paymentSessionData,
        resolvedOrderType,
        subtotal,
        deliveryFee,
        serviceFee,
        appCommission,
        visaCommission,
        shippingAddressSnapshot,
        branchSnapshotData,
        orderDiscountId,
        orderCouponId,
        orderFirstOrderDiscountId,
        totalDiscount,
        orderDiscountType,
        orderDiscountValue,
        orderDiscountSource,
        couponCode,
        note,
        targetShippingCompanyId,
        defaultPreparingDuration,
        userCart,
        itemsToInsert,
        restaurant,
        appliedCoupon,
        calculatedDeliveryFee,
        firstOrderDiscountAmount,
        appliedDiscountIds,
    } = params;

    let createdDailyOrderNumber = 1;

    await db.transaction(async (tx) => {
        // 🔒 Lock and validate weight request row if cart is weight-based
        if (hasWeightedItems && activeWeightRequest) {
            const [lockedReq] = await tx
                .select()
                .from(weightRequests)
                .where(
                    weightClaimRequestId
                        ? and(
                            eq(weightRequests.id, activeWeightRequest.id),
                            eq(weightRequests.status, "checking_out"),
                            isNull(weightRequests.orderId)
                        )
                        : and(
                            eq(weightRequests.id, activeWeightRequest.id),
                            eq(weightRequests.status, "awaiting_customer_approval")
                        )
                )
                .for("update");

            if (!lockedReq) {
                throw new BadRequest("Weighing request is no longer valid or has already been checked out.");
            }
            if (!weightClaimRequestId && new Date(lockedReq.expiresAt) <= new Date()) {
                throw new BadRequest("The weighing approval has expired. Please send your cart for weighing again.");
            }

            await assertWeightCartUnchanged(tx, lockedReq.id);
        }

        // Guest side-effects
        if (isGuestUser) {
            await tx
                .update(users)
                .set({
                    name: guestName!,
                    phone: guestPhone!,
                    ...(guestAltPhone ? { alternatePhone: guestAltPhone } : {}),
                })
                .where(eq(users.id, userId));

            if (pendingGuestAddress) {
                await tx.insert(addresses).values(pendingGuestAddress);
            }
        }

        // Wallet deduction with FOR UPDATE
        if (isWalletPayment) {
            const [userWallet] = await tx
                .select()
                .from(userWallets)
                .where(eq(userWallets.userId, userId))
                .for("update");

            const currentBalance = parseFloat((userWallet?.balance as string) || "0");
            if (!userWallet || currentBalance < totalAmount) {
                throw new BadRequest("Insufficient wallet balance");
            }

            const newBalance = roundMoney(currentBalance - totalAmount);

            await tx
                .update(userWallets)
                .set({ balance: newBalance.toFixed(2) })
                .where(eq(userWallets.userId, userId));

            await tx.insert(userWalletTransactions).values({
                id: uuidv4(),
                userId,
                type: "debit",
                transactionType: "order_payment",
                amount: totalAmount.toFixed(2),
                balanceBefore: currentBalance.toFixed(2),
                reference: orderNumber,
                status: "approved",
                createdAt: now,
            });
        }

        // Daily order number calculation
        if (!isVisaPayment) {
            createdDailyOrderNumber = await getNextDailyOrderNumber(tx, restaurantId, settings, now);
        }

        // Create order record
        await tx.insert(orders).values({
            id: orderId,
            orderNumber,
            idempotencyKey,
            userId,
            restaurantId,
            branchId: resolvedBranchId,
            zoneId: resolvedZoneId,
            addressId: addressId || null,
            orderSource: storedOrderSource as any,
            paymentMethod,
            paymentGatewayType: finalPaymentGatewayType,
            paymentGateway: paymentSessionData?.gateway
                ? (paymentSessionData.gateway.toLowerCase() as "kashier" | "paymob" | "geidea")
                : null,
            paymentOrderId:
                paymentSessionData?.paymentOrderId ||
                paymentSessionData?.paymobOrderId ||
                paymentSessionData?.geideaOrderId ||
                paymentSessionData?.sessionId ||
                null,
            paymentStatus: isVisaPayment ? "pending_payment" : "paid",
            orderType: resolvedOrderType,
            subtotal: subtotal.toFixed(2),
            deliveryFee: deliveryFee.toFixed(2),
            serviceFee: serviceFee.toFixed(2),
            appCommission: appCommission.toFixed(2),
            visaCommission: visaCommission.toFixed(2),

            shippingAddress: shippingAddressSnapshot,
            branchSnapshot: branchSnapshotData,

            discountId: orderDiscountId,
            couponId: orderCouponId,
            firstOrderDiscountId: orderFirstOrderDiscountId,
            discountAmount: totalDiscount.toFixed(2),
            discountType: orderDiscountType,
            discountValue: orderDiscountValue,
            discountSource: orderDiscountSource,

            couponCode: couponCode || null,
            taxAmount: (params.taxAmount ?? 0).toFixed(2),
            includedTaxAmount: (params.includedTaxAmount ?? 0).toFixed(2),
            taxDetails: params.taxDetails ?? [],
            totalAmount: totalAmount.toFixed(2),
            note: note || null,
            shippingCompanyId: targetShippingCompanyId || null,
            shippingStatus: "pending_dispatch",
            status: "pending",
            dailyOrderNumber: isVisaPayment ? null : createdDailyOrderNumber,
            durationOrderPreparing: defaultPreparingDuration,
            offerId: userCart.find((c) => c.offerId)?.offerId || null,
            isBundle: Boolean(userCart.some((c) => c.offerId)),
            createdAt: now,
        });

        if (isCashPayment) {
            await chargePendingServiceFee(orderId, tx, "cash_pending");
        }

        await tx.insert(orderItems).values(itemsToInsert.map((i) => ({ ...i, orderId })));

        if (hasWeightedItems && activeWeightRequest) {
            if (weightClaimRequestId) {
                await tx
                    .update(weightRequests)
                    .set({ orderId: orderId, updatedAt: now })
                    .where(
                        and(
                            eq(weightRequests.id, activeWeightRequest.id),
                            eq(weightRequests.status, "checking_out")
                        )
                    );
            } else {
                await tx
                    .update(weightRequests)
                    .set({
                        status: "approved",
                        orderId: orderId,
                        updatedAt: now,
                    })
                    .where(
                        and(
                            eq(weightRequests.id, activeWeightRequest.id),
                            eq(weightRequests.status, "awaiting_customer_approval")
                        )
                    );
            }
        }

        if (!isVisaPayment) {
            await tx
                .delete(cartItems)
                .where(and(eq(cartItems.userId, userId), eq(cartItems.restaurantId, restaurantId)));
        }

        // Increment user's total orders count
        await tx
            .update(users)
            .set({ totalOrders: sql`${users.totalOrders} + 1` })
            .where(eq(users.id, userId));

        // Increment user's total orders count for this restaurant
        const [existingPointRecord] = await tx
            .select()
            .from(userRestaurantPoints)
            .where(
                and(
                    eq(userRestaurantPoints.userId, userId),
                    eq(userRestaurantPoints.restaurantId, restaurantId)
                )
            )
            .for("update");

        if (existingPointRecord) {
            await tx
                .update(userRestaurantPoints)
                .set({ totalOrders: sql`${userRestaurantPoints.totalOrders} + 1` })
                .where(eq(userRestaurantPoints.id, existingPointRecord.id));
        } else {
            await tx.insert(userRestaurantPoints).values({
                id: uuidv4(),
                userId,
                restaurantId,
                totalOrders: 1,
                points: 0,
            });
        }

        // Superadmin notification
        if (!isVisaPayment) {
            await tx.insert(notifications).values({
                recipientType: "superadmin",
                recipientId: "superadmin",
                title: "New Order",
                body: `Order #${createdDailyOrderNumber} has been placed at ${restaurant?.name}.`,
                data: {
                    orderId,
                    orderNumber,
                    createdDailyOrderNumber,
                    restaurantName: restaurant?.name,
                },
            });
        }

        // Coupons and Discounts tracking
        if (appliedCoupon) {
            await tx.insert(couponUsages).values({
                id: uuidv4(),
                couponId: appliedCoupon.id,
                userId,
                orderId,
                discountAmount:
                    appliedCoupon.discountType === "free_delivery"
                        ? calculatedDeliveryFee.toFixed(2)
                        : totalDiscount.toFixed(2),
            });

            await tx
                .update(coupons)
                .set({ usedCount: sql`used_count + 1` })
                .where(eq(coupons.id, appliedCoupon.id));
        }

        if (orderFirstOrderDiscountId && !isVisaPayment) {
            await recordFirstOrderDiscountUsage(
                orderFirstOrderDiscountId,
                userId,
                orderId,
                firstOrderDiscountAmount,
                tx
            );
        }

        if (appliedDiscountIds.size > 0) {
            for (const dId of appliedDiscountIds) {
                await tx
                    .update(discounts)
                    .set({ usedCount: sql`used_count + 1` })
                    .where(eq(discounts.id, dId));
            }
        }
    });

    return { createdDailyOrderNumber };
};

/**
 * Sends a push notification to the restaurant if the order is confirmed (non-visa).
 */
export const notifyRestaurantAfterOrder = async (params: {
    isVisaPayment: boolean;
    restaurantId: string;
    resolvedBranchId: string | null;
    createdDailyOrderNumber: number;
    totalAmount: number;
    orderId: string;
    orderNumber: string;
    now: Date;
}) => {
    const {
        isVisaPayment,
        restaurantId,
        resolvedBranchId,
        createdDailyOrderNumber,
        totalAmount,
        orderId,
        orderNumber,
        now,
    } = params;

    if (!isVisaPayment) {
        const cairoTimeFormatted = new Intl.DateTimeFormat("ar-EG", {
            timeZone: "Africa/Cairo",
            hour: "numeric",
            minute: "numeric",
            hour12: true,
        }).format(now);

        await sendPushNotification({
            recipientType: "restaurant",
            recipientId: restaurantId,
            branchId: resolvedBranchId || null,
            title: "طلب جديد! 🛒",
            body: `تم استلام طلب جديد #${createdDailyOrderNumber} بقيمة ${totalAmount} ج.م الساعة ${cairoTimeFormatted}.`,
            data: {
                restaurantId,
                orderId,
                orderNumber,
                branchId: resolvedBranchId || null,
                type: "new_order",
                createdAt: now.toISOString(),
                dailyOrderNumber: createdDailyOrderNumber,
            },
        });
    }
};

/**
 * Formats the standard response payload for checkout.
 */
export const formatCheckoutResponsePayload = (params: {
    orderId: string;
    orderNumber: string;
    paymentSessionData: any;
    resolvedZoneId: string | null;
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    totalDiscount: number;
    couponCode?: string;
    totalAmount: number;
    now: Date;
    createdDailyOrderNumber: number;
    defaultPreparingDuration: number;
    orderDiscountId: string | null;
    orderCouponId: string | null;
    orderFirstOrderDiscountId: string | null;
    orderDiscountType: any;
    orderDiscountValue: any;
    orderDiscountSource: any;
    isFreeDelivery: boolean;
    userInfo: any;
    taxAmount?: number;
    includedTaxAmount?: number;
    taxDetails?: any[];
}) => {
    const {
        orderId,
        orderNumber,
        paymentSessionData,
        resolvedZoneId,
        subtotal,
        deliveryFee,
        serviceFee,
        totalDiscount,
        couponCode,
        totalAmount,
        now,
        createdDailyOrderNumber,
        defaultPreparingDuration,
        orderDiscountId,
        orderCouponId,
        orderFirstOrderDiscountId,
        orderDiscountType,
        orderDiscountValue,
        orderDiscountSource,
        isFreeDelivery,
        userInfo,
    } = params;

    return {
        message: "Order created successfully",
        payment: paymentSessionData
            ? {
                gateway: paymentSessionData.gateway,
                type: paymentSessionData.type,
                sessionId: paymentSessionData.sessionId,
                sessionUrl: paymentSessionData.sessionUrl,
                status: paymentSessionData.status,
                expireAt: paymentSessionData.expireAt,
                error: paymentSessionData.error,
            }
            : null,
        order_level: {
            orderDetails: {
                orderId,
                orderNumber,
                paymentSessionUrl: paymentSessionData?.sessionUrl || null,
                zoneId: resolvedZoneId,
                subtotal,
                deliveryFee,
                serviceFee,
                discountAmount: totalDiscount,
                couponCode: couponCode || null,
                taxAmount: params.taxAmount ?? 0,
                includedTaxAmount: params.includedTaxAmount ?? 0,
                totalAmount,
                createdAt: now.toISOString(),
                dailyOrderNumber: createdDailyOrderNumber,
                durationOrderPreparing: defaultPreparingDuration,
            },
            discountDetails: {
                discountId: orderDiscountId,
                couponId: orderCouponId,
                firstOrderDiscountId: orderFirstOrderDiscountId,
                discountAmount: totalDiscount,
                discountType: orderDiscountType,
                discountValue: orderDiscountValue,
                discountSource: orderDiscountSource,
                couponCode: couponCode || null,
                isFreeDelivery,
            },
            taxDetails: {
                taxAmount: params.taxAmount ?? 0,
                includedTaxAmount: params.includedTaxAmount ?? 0,
                taxes: params.taxDetails ?? [],
            },
            customerDetails: userInfo,
        },
    };
};
