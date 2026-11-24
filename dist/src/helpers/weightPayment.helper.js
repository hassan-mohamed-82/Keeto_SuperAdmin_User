"use strict";
// Payment handling for orders that belong to a WEIGHT REQUEST only.
//
// The success / failure BODIES live in orderPaymentConfirmation.ts (single copy). This file only
// holds the small weighted hooks those bodies call when isWeightedOrder() is true, plus the request
// transitions shared with checkout re-try and the expiry cron. Every hook is a no-op for normal orders
// because the caller only invokes it for weighted orders.
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyWeightRequestExpiredAfterPayments = exports.failWeightedOrderInTx = exports.expireWeightRequestInTx = exports.revertWeightRequestInTx = exports.applyWeightedFailureToRequestInTx = exports.weightedFailureGateInTx = exports.approveWeightRequestInTx = exports.claimWeightedConfirmationInTx = exports.handleLateWeightedPayment = exports.recordNeedsReview = exports.isWeightedOrder = void 0;
exports.resolveCheckingOutRequest = resolveCheckingOutRequest;
exports.claimWeightCheckout = claimWeightCheckout;
exports.releaseWeightCheckoutClaim = releaseWeightCheckoutClaim;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const BadRequest_1 = require("../Errors/BadRequest");
const uuid_1 = require("uuid");
const notifications_1 = require("../utils/notifications");
const weightCart_helper_1 = require("./weightCart.helper");
/** mysql2 update result → affected rows. */
const affectedRows = (result) => Number((Array.isArray(result) ? result[0]?.affectedRows : result?.affectedRows) ?? 0);
/**
 * True when the order belongs to a weight request: a request still points at it
 * (weight_requests.order_id), or it has weighted order items (order_items.weight_unit set),
 * which also catches an OLD order whose request has since moved on to a newer order.
 */
const isWeightedOrder = async (orderId, executor = connection_1.db) => {
    const [req] = await executor
        .select({ id: schema_1.weightRequests.id })
        .from(schema_1.weightRequests)
        .where((0, drizzle_orm_1.eq)(schema_1.weightRequests.orderId, orderId))
        .limit(1);
    if (req)
        return true;
    const [item] = await executor
        .select({ id: schema_1.orderItems.id })
        .from(schema_1.orderItems)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orderItems.orderId, orderId), (0, drizzle_orm_1.isNotNull)(schema_1.orderItems.weightUnit)))
        .limit(1);
    return Boolean(item);
};
exports.isWeightedOrder = isWeightedOrder;
// ─────────────────────────────────────────────
// Late payment (needs_review)
// ─────────────────────────────────────────────
/**
 * Records a late payment for manual refund: idempotent per (order, gateway transaction id),
 * plus a searchable warning log (no card data, no payload in the log).
 */
const recordNeedsReview = async (executor, order, request, info) => {
    const [existing] = await executor
        .select({ id: schema_1.paymentTransactions.id })
        .from(schema_1.paymentTransactions)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.paymentTransactions.orderId, order.id), (0, drizzle_orm_1.eq)(schema_1.paymentTransactions.status, "needs_review"), info.transactionId ? (0, drizzle_orm_1.eq)(schema_1.paymentTransactions.transactionId, info.transactionId) : (0, drizzle_orm_1.isNull)(schema_1.paymentTransactions.transactionId)))
        .limit(1);
    if (!existing) {
        await executor.insert(schema_1.paymentTransactions).values({
            id: (0, uuid_1.v4)(),
            orderId: order.id,
            orderNumber: order.orderNumber,
            userId: order.userId,
            restaurantId: order.restaurantId,
            gateway: info.gateway,
            transactionId: info.transactionId || null,
            gatewayOrderId: info.gatewayOrderId || order.paymentOrderId || null,
            amount: order.totalAmount,
            currency: "EGP",
            status: "needs_review",
            failureReason: `LATE_PAYMENT: weight request ${request?.id ?? "none"} is ${request?.status ?? "missing"}` +
                `${request && request.orderId !== order.id ? " (points at another order)" : ""}; ` +
                `order ${order.status}/${order.paymentStatus}. Refund manually from the gateway dashboard.`,
            rawResponse: info.rawPayload || null,
            createdAt: new Date(),
        });
    }
    console.warn(`[WEIGHT_LATE_PAYMENT_NEEDS_REVIEW] order=${order.id} orderNumber=${order.orderNumber} gateway=${info.gateway} ` +
        `txn=${info.transactionId ?? "-"} gatewayOrder=${info.gatewayOrderId ?? order.paymentOrderId ?? "-"} ` +
        `amount=${order.totalAmount} orderStatus=${order.status}/${order.paymentStatus} ` +
        `request=${request?.id ?? "-"}/${request?.status ?? "-"}${existing ? " (already recorded)" : ""}`);
};
exports.recordNeedsReview = recordNeedsReview;
/**
 * confirmOrderPayment hook, BEFORE its transaction (unlocked fast path): a payment for an order that
 * is failed / cancelled, or whose request no longer points at it / is not checking_out, is recorded
 * as needs_review and must not be confirmed. Returns true when it was handled here.
 */
const handleLateWeightedPayment = async (order, info) => {
    const [request] = await connection_1.db
        .select({ id: schema_1.weightRequests.id, status: schema_1.weightRequests.status, orderId: schema_1.weightRequests.orderId })
        .from(schema_1.weightRequests)
        .where((0, drizzle_orm_1.eq)(schema_1.weightRequests.orderId, order.id))
        .limit(1);
    const decision = (0, weightCart_helper_1.decideWeightedPaymentSuccess)({
        order: { id: order.id, paymentStatus: order.paymentStatus, status: order.status },
        request: request ?? null,
    });
    if (decision !== "needs_review")
        return false;
    await connection_1.db.transaction(async (tx) => (0, exports.recordNeedsReview)(tx, order, request ?? null, info));
    return true;
};
exports.handleLateWeightedPayment = handleLateWeightedPayment;
/**
 * confirmOrderPayment hook, at the START of its transaction. Locks request + order, re-validates,
 * then claims the confirmation with a conditional update (pending_payment → paid). Only "confirm"
 * lets the existing body continue; "already_paid" (0 rows: someone else confirmed) and
 * "needs_review" (state changed since the fast path) stop it.
 */
const claimWeightedConfirmationInTx = async (tx, orderId, info, now) => {
    const [request] = await tx.select().from(schema_1.weightRequests).where((0, drizzle_orm_1.eq)(schema_1.weightRequests.orderId, orderId)).for("update");
    const [order] = await tx.select().from(schema_1.orders).where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId)).for("update");
    if (!order)
        return "already_paid";
    const decision = (0, weightCart_helper_1.decideWeightedPaymentSuccess)({
        order: { id: order.id, paymentStatus: order.paymentStatus, status: order.status },
        request: request ? { orderId: request.orderId, status: request.status } : null,
    });
    if (decision === "already_paid")
        return "already_paid";
    if (decision === "needs_review") {
        await (0, exports.recordNeedsReview)(tx, order, request ?? null, info);
        return "needs_review";
    }
    const claimed = await tx
        .update(schema_1.orders)
        .set({ paymentStatus: "paid", updatedAt: now })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId), (0, drizzle_orm_1.eq)(schema_1.orders.paymentStatus, "pending_payment")));
    return affectedRows(claimed) === 1 ? "confirm" : "already_paid";
};
exports.claimWeightedConfirmationInTx = claimWeightedConfirmationInTx;
/** confirmOrderPayment hook, at the END of its transaction: checking_out → approved. */
const approveWeightRequestInTx = async (tx, orderId, now) => {
    await tx
        .update(schema_1.weightRequests)
        .set({ status: "approved", checkoutStartedAt: null, updatedAt: now })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.orderId, orderId), (0, drizzle_orm_1.eq)(schema_1.weightRequests.status, "checking_out")));
};
exports.approveWeightRequestInTx = approveWeightRequestInTx;
/**
 * recordFailedPayment hook, at the START of its transaction: locks order + request and decides.
 * "ignore" (order already paid / past pending / already failed) means the existing body must not run.
 */
const weightedFailureGateInTx = async (tx, orderId) => {
    const [order] = await tx.select().from(schema_1.orders).where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId)).for("update");
    const [request] = await tx.select().from(schema_1.weightRequests).where((0, drizzle_orm_1.eq)(schema_1.weightRequests.orderId, orderId)).for("update");
    if (!order)
        return { outcome: "ignore", request: null, order: null };
    const outcome = (0, weightCart_helper_1.decideWeightedPaymentFailure)({
        order: { id: order.id, paymentStatus: order.paymentStatus, status: order.status },
        request: request ? { orderId: request.orderId, status: request.status, paymentAttempts: request.paymentAttempts ?? 0 } : null,
    });
    return { outcome, request: request ?? null, order };
};
exports.weightedFailureGateInTx = weightedFailureGateInTx;
/**
 * recordFailedPayment hook, at the END of its transaction: revert the request (attempts + 1, fresh
 * customer window) or expire it at MAX_PAYMENT_ATTEMPTS. Returns the expiry to notify AFTER commit.
 */
const applyWeightedFailureToRequestInTx = async (tx, gate, now) => {
    if (gate.outcome === "revert") {
        await (0, exports.revertWeightRequestInTx)(tx, gate.request, { incrementAttempts: true, now });
    }
    else if (gate.outcome === "expire") {
        const changed = await (0, exports.expireWeightRequestInTx)(tx, gate.request.id, `payment failed ${weightCart_helper_1.MAX_PAYMENT_ATTEMPTS} times`, now);
        if (changed)
            return { userId: gate.order.userId, requestId: gate.request.id };
    }
    return null;
};
exports.applyWeightedFailureToRequestInTx = applyWeightedFailureToRequestInTx;
// ─────────────────────────────────────────────
// Request transitions (shared with checkout re-try and the cron)
// ─────────────────────────────────────────────
/** Back to awaiting_customer_approval with a fresh customer window; weighted rows stay locked. */
const revertWeightRequestInTx = async (tx, request, opts) => {
    const [settings] = await tx
        .select({ weightCustomerTimeoutMin: schema_1.restaurantSettings.weightCustomerTimeoutMin })
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, request.restaurantId))
        .limit(1);
    // Fallback when the restaurant has no settings row: the agreed 15 minutes.
    const timeoutMin = settings?.weightCustomerTimeoutMin ?? weightCart_helper_1.DEFAULT_WEIGHT_CUSTOMER_TIMEOUT_MIN;
    await tx
        .update(schema_1.weightRequests)
        .set({
        status: "awaiting_customer_approval",
        expiresAt: new Date(opts.now.getTime() + timeoutMin * 60 * 1000),
        checkoutStartedAt: null,
        ...(opts.incrementAttempts ? { paymentAttempts: (0, drizzle_orm_1.sql) `${schema_1.weightRequests.paymentAttempts} + 1` } : {}),
        updatedAt: opts.now,
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, request.id), (0, drizzle_orm_1.eq)(schema_1.weightRequests.status, "checking_out")));
};
exports.revertWeightRequestInTx = revertWeightRequestInTx;
/**
 * Expire with the normal cleanup (restaurant rows deleted, customer rows unlocked and reset).
 * The cleanup runs ONLY if the conditional update actually changed the request. Returns that.
 */
const expireWeightRequestInTx = async (tx, requestId, reason, now) => {
    const result = await tx
        .update(schema_1.weightRequests)
        .set({
        status: "expired",
        cancelReason: reason,
        checkoutStartedAt: null,
        paymentAttempts: (0, drizzle_orm_1.sql) `${schema_1.weightRequests.paymentAttempts} + 1`,
        updatedAt: now,
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, requestId), (0, drizzle_orm_1.eq)(schema_1.weightRequests.status, "checking_out")));
    if (affectedRows(result) !== 1)
        return false;
    await tx.delete(schema_1.cartItems).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.weightRequestId, requestId), (0, drizzle_orm_1.eq)(schema_1.cartItems.addedBy, "restaurant")));
    await tx
        .update(schema_1.cartItems)
        .set({ weightRequestId: null, finalWeight: null, isUnavailable: false, updatedAt: now })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.cartItems.weightRequestId, requestId), (0, drizzle_orm_1.eq)(schema_1.cartItems.addedBy, "customer")));
    return true;
};
exports.expireWeightRequestInTx = expireWeightRequestInTx;
/**
 * Marks an unpaid weighted order failed WITHOUT a gateway response (abandoned / superseded attempt:
 * checkout re-try; the Restaurant cron has its own copy) and moves its request back, or expires it at
 * MAX_PAYMENT_ATTEMPTS. Same order / coupon effects as recordFailedPayment, no payment_transactions row
 * (there is no gateway result). Caller holds the transaction with order + request locked FOR UPDATE.
 */
const failWeightedOrderInTx = async (tx, order, request, opts) => {
    const outcome = (0, weightCart_helper_1.decideWeightedPaymentFailure)({
        order: { id: order.id, paymentStatus: order.paymentStatus, status: order.status },
        request: request ? { orderId: request.orderId, status: request.status, paymentAttempts: request.paymentAttempts ?? 0 } : null,
    });
    const result = { outcome, userId: order.userId, requestId: request?.id ?? null, expired: false };
    if (outcome === "ignore")
        return result;
    await tx
        .update(schema_1.orders)
        .set({
        status: "failed",
        paymentStatus: "payment_failed",
        paymentFailureReason: opts.failureReason,
        updatedAt: opts.now,
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.orders.id, order.id), (0, drizzle_orm_1.eq)(schema_1.orders.paymentStatus, "pending_payment")));
    const [usage] = await tx.select().from(schema_1.couponUsages).where((0, drizzle_orm_1.eq)(schema_1.couponUsages.orderId, order.id)).limit(1);
    if (usage) {
        await tx.delete(schema_1.couponUsages).where((0, drizzle_orm_1.eq)(schema_1.couponUsages.id, usage.id));
        if (usage.couponId) {
            await tx.update(schema_1.coupons).set({ usedCount: (0, drizzle_orm_1.sql) `GREATEST(used_count - 1, 0)` }).where((0, drizzle_orm_1.eq)(schema_1.coupons.id, usage.couponId));
        }
    }
    if (outcome === "revert") {
        await (0, exports.revertWeightRequestInTx)(tx, request, { incrementAttempts: true, now: opts.now });
    }
    else if (outcome === "expire") {
        result.expired = await (0, exports.expireWeightRequestInTx)(tx, request.id, `payment failed ${weightCart_helper_1.MAX_PAYMENT_ATTEMPTS} times`, opts.now);
    }
    return result;
};
exports.failWeightedOrderInTx = failWeightedOrderInTx;
const notifyWeightRequestExpiredAfterPayments = async (userId, requestId) => {
    try {
        await (0, notifications_1.sendPushNotification)({
            recipientType: "user",
            recipientId: userId,
            title: "تم إلغاء طلب الوزن ❌",
            body: `فشل الدفع ${weightCart_helper_1.MAX_PAYMENT_ATTEMPTS} مرات، تم إلغاء طلب الوزن. يمكنك إرسال السلة للوزن مرة أخرى.`,
            data: { type: "weight_request_expired", weightRequestId: requestId, reason: "payment_failed" },
        });
    }
    catch (err) {
        console.warn(`[WeightPayment] expiry notification failed for request ${requestId}:`, err);
    }
};
exports.notifyWeightRequestExpiredAfterPayments = notifyWeightRequestExpiredAfterPayments;
// ─────────────────────────────────────────────
// Checkout claim (Visa + weighted only)
// ─────────────────────────────────────────────
/**
 * A checkout found the request in checking_out (option b, agreed):
 * - younger than CHECKOUT_RETRY_MIN_AGE_MINUTES → "payment in progress" (a double click never
 *   fails the first order while its payment page may be open);
 * - older and the order is still pending_payment → in ONE locked transaction fail that order through
 *   the weighted failure path and revert the request (attempts + 1, may expire at the limit);
 * - claim without an order, or order already failed → revert the claim.
 * A late payment of the superseded order is later recorded as needs_review by confirmOrderPayment.
 */
async function resolveCheckingOutRequest(requestId) {
    const now = new Date();
    let thrown = null;
    let expired = null;
    await connection_1.db.transaction(async (tx) => {
        const [request] = await tx.select().from(schema_1.weightRequests).where((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, requestId)).for("update");
        if (!request || request.status !== "checking_out")
            return; // someone else moved it on
        const [order] = request.orderId
            ? await tx.select().from(schema_1.orders).where((0, drizzle_orm_1.eq)(schema_1.orders.id, request.orderId)).for("update")
            : [null];
        const decision = (0, weightCart_helper_1.decideCheckoutRetry)({
            checkoutStartedAt: request.checkoutStartedAt,
            order: order ? { paymentStatus: order.paymentStatus, status: order.status, createdAt: order.createdAt } : null,
            now,
        });
        if (decision === "in_progress") {
            thrown = new weightCart_helper_1.WeightPaymentInProgressError(request.id);
            return;
        }
        if (decision === "already_paid") {
            thrown = new BadRequest_1.BadRequest("This order has already been paid.");
            return;
        }
        if (decision === "fail_old_order") {
            const r = await (0, exports.failWeightedOrderInTx)(tx, order, request, {
                failureReason: "Abandoned: the customer started a new checkout",
                now,
            });
            if (r.expired)
                expired = { userId: r.userId, requestId: request.id };
            return;
        }
        // revert_claim / revert_after_failed_order
        await (0, exports.revertWeightRequestInTx)(tx, request, { incrementAttempts: false, now });
    });
    if (thrown)
        throw thrown;
    if (expired) {
        const e = expired;
        await (0, exports.notifyWeightRequestExpiredAfterPayments)(e.userId, e.requestId);
        throw new BadRequest_1.BadRequest(`Payment failed ${weightCart_helper_1.MAX_PAYMENT_ATTEMPTS} times, so the weighing request was cancelled. Please send your cart for weighing again.`);
    }
}
/**
 * Moves the request awaiting_customer_approval → checking_out (conditional update: one concurrent
 * checkout wins). `assertCartUnchanged` re-checks the cart under the same lock.
 * Clears order_id so the claim is never confused with an older (failed) order of the same request.
 */
async function claimWeightCheckout(requestId, assertCartUnchanged) {
    const now = new Date();
    await connection_1.db.transaction(async (tx) => {
        const [request] = await tx.select().from(schema_1.weightRequests).where((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, requestId)).for("update");
        if (!request)
            throw new BadRequest_1.BadRequest("Weighing request is no longer valid.");
        if (request.status === "checking_out")
            throw new weightCart_helper_1.WeightPaymentInProgressError(request.id, "Checkout already in progress.");
        if (request.status !== "awaiting_customer_approval") {
            throw new BadRequest_1.BadRequest("Weighing request is no longer valid or has already been checked out.");
        }
        if (new Date(request.expiresAt) <= now) {
            throw new BadRequest_1.BadRequest("The weighing approval has expired. Please send your cart for weighing again.");
        }
        await assertCartUnchanged(tx, request.id);
        const result = await tx
            .update(schema_1.weightRequests)
            .set({ status: "checking_out", checkoutStartedAt: now, orderId: null, updatedAt: now })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, request.id), (0, drizzle_orm_1.eq)(schema_1.weightRequests.status, "awaiting_customer_approval")));
        if (affectedRows(result) !== 1)
            throw new weightCart_helper_1.WeightPaymentInProgressError(request.id, "Checkout already in progress.");
    });
}
/** Undo a claim whose session or order transaction failed (no order was created). */
async function releaseWeightCheckoutClaim(requestId) {
    try {
        await connection_1.db
            .update(schema_1.weightRequests)
            .set({ status: "awaiting_customer_approval", checkoutStartedAt: null, updatedAt: new Date() })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.id, requestId), (0, drizzle_orm_1.eq)(schema_1.weightRequests.status, "checking_out"), (0, drizzle_orm_1.isNull)(schema_1.weightRequests.orderId)));
    }
    catch (err) {
        // The cron reverts a claim without an order after CHECKOUT_NO_ORDER_MINUTES anyway.
        console.error(`[WeightCheckout] failed to release claim ${requestId}:`, err);
    }
}
