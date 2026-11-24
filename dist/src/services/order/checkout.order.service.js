"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCheckoutResponsePayload = exports.notifyRestaurantAfterOrder = exports.executeOrderTransaction = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const getNextDailyOrderNumber_1 = require("../../helpers/getNextDailyOrderNumber");
const restaurantWalletService_1 = require("../restaurantWalletService");
const firstOrderDiscount_helper_1 = require("../../helpers/firstOrderDiscount.helper");
const notifications_1 = require("../../utils/notifications");
const checkout_types_1 = require("./checkout.types");
/**
 * Executes the main order database transaction.
 */
const executeOrderTransaction = async (params) => {
    const { now, hasWeightedItems, activeWeightRequest, weightClaimRequestId, assertWeightCartUnchanged, isGuestUser, guestName, guestPhone, guestAltPhone, pendingGuestAddress, isWalletPayment, isCashPayment, isVisaPayment, userId, totalAmount, orderNumber, restaurantId, settings, orderId, idempotencyKey, resolvedBranchId, resolvedZoneId, addressId, storedOrderSource, paymentMethod, finalPaymentGatewayType, paymentSessionData, resolvedOrderType, subtotal, deliveryFee, serviceFee, appCommission, visaCommission, shippingAddressSnapshot, branchSnapshotData, orderDiscountId, orderCouponId, orderFirstOrderDiscountId, totalDiscount, orderDiscountType, orderDiscountValue, orderDiscountSource, couponCode, note, targetShippingCompanyId, defaultPreparingDuration, userCart, itemsToInsert, restaurant, appliedCoupon, calculatedDeliveryFee, firstOrderDiscountAmount, appliedDiscountIds, } = params;
    let createdDailyOrderNumber = 1;
    await connection_1.db.transaction(async (tx) => {
        // 🔒 Lock and validate weight request row if cart is weight-based
        if (hasWeightedItems && activeWeightRequest) {
            const [lockedReq] = await tx
                .select()
                .from(schema_1.weightRequests)
                .where(weightClaimRequestId
                ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, activeWeightRequest.id), (0, drizzle_orm_1.eq)(schema_1.weightRequests.status, "checking_out"), (0, drizzle_orm_1.isNull)(schema_1.weightRequests.orderId))
                : (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, activeWeightRequest.id), (0, drizzle_orm_1.eq)(schema_1.weightRequests.status, "awaiting_customer_approval")))
                .for("update");
            if (!lockedReq) {
                throw new BadRequest_1.BadRequest("Weighing request is no longer valid or has already been checked out.");
            }
            if (!weightClaimRequestId && new Date(lockedReq.expiresAt) <= new Date()) {
                throw new BadRequest_1.BadRequest("The weighing approval has expired. Please send your cart for weighing again.");
            }
            await assertWeightCartUnchanged(tx, lockedReq.id);
        }
        // Guest side-effects
        if (isGuestUser) {
            await tx
                .update(schema_1.users)
                .set({
                name: guestName,
                phone: guestPhone,
                ...(guestAltPhone ? { alternatePhone: guestAltPhone } : {}),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
            if (pendingGuestAddress) {
                await tx.insert(schema_1.addresses).values(pendingGuestAddress);
            }
        }
        // Wallet deduction with FOR UPDATE
        if (isWalletPayment) {
            const [userWallet] = await tx
                .select()
                .from(schema_1.userWallets)
                .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId))
                .for("update");
            const currentBalance = parseFloat(userWallet?.balance || "0");
            if (!userWallet || currentBalance < totalAmount) {
                throw new BadRequest_1.BadRequest("Insufficient wallet balance");
            }
            const newBalance = (0, checkout_types_1.roundMoney)(currentBalance - totalAmount);
            await tx
                .update(schema_1.userWallets)
                .set({ balance: newBalance.toFixed(2) })
                .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId));
            await tx.insert(schema_1.userWalletTransactions).values({
                id: (0, uuid_1.v4)(),
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
            createdDailyOrderNumber = await (0, getNextDailyOrderNumber_1.getNextDailyOrderNumber)(tx, restaurantId, settings, now);
        }
        // Create order record
        await tx.insert(schema_1.orders).values({
            id: orderId,
            orderNumber,
            idempotencyKey,
            userId,
            restaurantId,
            branchId: resolvedBranchId,
            zoneId: resolvedZoneId,
            addressId: addressId || null,
            orderSource: storedOrderSource,
            paymentMethod,
            paymentGatewayType: finalPaymentGatewayType,
            paymentGateway: paymentSessionData?.gateway
                ? paymentSessionData.gateway.toLowerCase()
                : null,
            paymentOrderId: paymentSessionData?.paymentOrderId ||
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
            await (0, restaurantWalletService_1.chargePendingServiceFee)(orderId, tx, "cash_pending");
        }
        await tx.insert(schema_1.orderItems).values(itemsToInsert.map((i) => ({ ...i, orderId })));
        if (hasWeightedItems && activeWeightRequest) {
            if (weightClaimRequestId) {
                await tx
                    .update(schema_1.weightRequests)
                    .set({ orderId: orderId, updatedAt: now })
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, activeWeightRequest.id), (0, drizzle_orm_1.eq)(schema_1.weightRequests.status, "checking_out")));
            }
            else {
                await tx
                    .update(schema_1.weightRequests)
                    .set({
                    status: "approved",
                    orderId: orderId,
                    updatedAt: now,
                })
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, activeWeightRequest.id), (0, drizzle_orm_1.eq)(schema_1.weightRequests.status, "awaiting_customer_approval")));
            }
        }
        if (!isVisaPayment) {
            await tx
                .delete(schema_1.cartItems)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.userId, userId), (0, drizzle_orm_1.eq)(schema_1.cartItems.restaurantId, restaurantId)));
        }
        // Increment user's total orders count
        await tx
            .update(schema_1.users)
            .set({ totalOrders: (0, drizzle_orm_1.sql) `${schema_1.users.totalOrders} + 1` })
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
        // Increment user's total orders count for this restaurant
        const [existingPointRecord] = await tx
            .select()
            .from(schema_1.userRestaurantPoints)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.restaurantId, restaurantId)))
            .for("update");
        if (existingPointRecord) {
            await tx
                .update(schema_1.userRestaurantPoints)
                .set({ totalOrders: (0, drizzle_orm_1.sql) `${schema_1.userRestaurantPoints.totalOrders} + 1` })
                .where((0, drizzle_orm_1.eq)(schema_1.userRestaurantPoints.id, existingPointRecord.id));
        }
        else {
            await tx.insert(schema_1.userRestaurantPoints).values({
                id: (0, uuid_1.v4)(),
                userId,
                restaurantId,
                totalOrders: 1,
                points: 0,
            });
        }
        // Superadmin notification
        if (!isVisaPayment) {
            await tx.insert(schema_1.notifications).values({
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
            await tx.insert(schema_1.couponUsages).values({
                id: (0, uuid_1.v4)(),
                couponId: appliedCoupon.id,
                userId,
                orderId,
                discountAmount: appliedCoupon.discountType === "free_delivery"
                    ? calculatedDeliveryFee.toFixed(2)
                    : totalDiscount.toFixed(2),
            });
            await tx
                .update(schema_1.coupons)
                .set({ usedCount: (0, drizzle_orm_1.sql) `used_count + 1` })
                .where((0, drizzle_orm_1.eq)(schema_1.coupons.id, appliedCoupon.id));
        }
        if (orderFirstOrderDiscountId && !isVisaPayment) {
            await (0, firstOrderDiscount_helper_1.recordFirstOrderDiscountUsage)(orderFirstOrderDiscountId, userId, orderId, firstOrderDiscountAmount, tx);
        }
        if (appliedDiscountIds.size > 0) {
            for (const dId of appliedDiscountIds) {
                await tx
                    .update(schema_1.discounts)
                    .set({ usedCount: (0, drizzle_orm_1.sql) `used_count + 1` })
                    .where((0, drizzle_orm_1.eq)(schema_1.discounts.id, dId));
            }
        }
    });
    return { createdDailyOrderNumber };
};
exports.executeOrderTransaction = executeOrderTransaction;
/**
 * Sends a push notification to the restaurant if the order is confirmed (non-visa).
 */
const notifyRestaurantAfterOrder = async (params) => {
    const { isVisaPayment, restaurantId, resolvedBranchId, createdDailyOrderNumber, totalAmount, orderId, orderNumber, now, } = params;
    if (!isVisaPayment) {
        const cairoTimeFormatted = new Intl.DateTimeFormat("ar-EG", {
            timeZone: "Africa/Cairo",
            hour: "numeric",
            minute: "numeric",
            hour12: true,
        }).format(now);
        await (0, notifications_1.sendPushNotification)({
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
exports.notifyRestaurantAfterOrder = notifyRestaurantAfterOrder;
/**
 * Formats the standard response payload for checkout.
 */
const formatCheckoutResponsePayload = (params) => {
    const { orderId, orderNumber, paymentSessionData, resolvedZoneId, subtotal, deliveryFee, serviceFee, totalDiscount, couponCode, totalAmount, now, createdDailyOrderNumber, defaultPreparingDuration, orderDiscountId, orderCouponId, orderFirstOrderDiscountId, orderDiscountType, orderDiscountValue, orderDiscountSource, isFreeDelivery, userInfo, } = params;
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
            customerDetails: userInfo,
        },
    };
};
exports.formatCheckoutResponsePayload = formatCheckoutResponsePayload;
