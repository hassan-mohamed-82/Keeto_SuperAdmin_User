// Payment handling for orders that belong to a WEIGHT REQUEST only.
//
// The success / failure BODIES live in orderPaymentConfirmation.ts (single copy). This file only
// holds the small weighted hooks those bodies call when isWeightedOrder() is true, plus the request
// transitions shared with checkout re-try and the expiry cron. Every hook is a no-op for normal orders
// because the caller only invokes it for weighted orders.

import { db } from "../models/connection";
import {
    orders,
    orderItems,
    restaurantSettings,
    paymentTransactions,
    cartItems,
    couponUsages,
    coupons,
    weightRequests,
} from "../models/schema";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { BadRequest } from "../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";
import { sendPushNotification } from "../utils/notifications";
import {
    decideCheckoutRetry,
    WeightPaymentInProgressError,
    decideWeightedPaymentFailure,
    decideWeightedPaymentSuccess,
    DEFAULT_WEIGHT_CUSTOMER_TIMEOUT_MIN,
    MAX_PAYMENT_ATTEMPTS,
} from "./weightCart.helper";

type Gateway = "paymob" | "kashier" | "geidea";

export interface WeightedPaymentInfo {
    gateway: Gateway;
    transactionId?: string;
    gatewayOrderId?: string;
    rawPayload?: any;
}

/** mysql2 update result → affected rows. */
const affectedRows = (result: any): number =>
    Number((Array.isArray(result) ? result[0]?.affectedRows : result?.affectedRows) ?? 0);

/**
 * True when the order belongs to a weight request: a request still points at it
 * (weight_requests.order_id), or it has weighted order items (order_items.weight_unit set),
 * which also catches an OLD order whose request has since moved on to a newer order.
 */
export const isWeightedOrder = async (orderId: string, executor: any = db): Promise<boolean> => {
    const [req] = await executor
        .select({ id: weightRequests.id })
        .from(weightRequests)
        .where(eq(weightRequests.orderId, orderId))
        .limit(1);
    if (req) return true;
    const [item] = await executor
        .select({ id: orderItems.id })
        .from(orderItems)
        .where(and(eq(orderItems.orderId, orderId), isNotNull(orderItems.weightUnit)))
        .limit(1);
    return Boolean(item);
};

// ─────────────────────────────────────────────
// Late payment (needs_review)
// ─────────────────────────────────────────────

/**
 * Records a late payment for manual refund: idempotent per (order, gateway transaction id),
 * plus a searchable warning log (no card data, no payload in the log).
 */
export const recordNeedsReview = async (
    executor: any,
    order: any,
    request: { id: string; status: string; orderId: string | null } | null,
    info: WeightedPaymentInfo
): Promise<void> => {
    const [existing] = await executor
        .select({ id: paymentTransactions.id })
        .from(paymentTransactions)
        .where(and(
            eq(paymentTransactions.orderId, order.id),
            eq(paymentTransactions.status, "needs_review"),
            info.transactionId ? eq(paymentTransactions.transactionId, info.transactionId) : isNull(paymentTransactions.transactionId)
        ))
        .limit(1);
    if (!existing) {
        await executor.insert(paymentTransactions).values({
            id: uuidv4(),
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
            failureReason:
                `LATE_PAYMENT: weight request ${request?.id ?? "none"} is ${request?.status ?? "missing"}` +
                `${request && request.orderId !== order.id ? " (points at another order)" : ""}; ` +
                `order ${order.status}/${order.paymentStatus}. Refund manually from the gateway dashboard.`,
            rawResponse: info.rawPayload || null,
            createdAt: new Date(),
        });
    }
    console.warn(
        `[WEIGHT_LATE_PAYMENT_NEEDS_REVIEW] order=${order.id} orderNumber=${order.orderNumber} gateway=${info.gateway} ` +
        `txn=${info.transactionId ?? "-"} gatewayOrder=${info.gatewayOrderId ?? order.paymentOrderId ?? "-"} ` +
        `amount=${order.totalAmount} orderStatus=${order.status}/${order.paymentStatus} ` +
        `request=${request?.id ?? "-"}/${request?.status ?? "-"}${existing ? " (already recorded)" : ""}`
    );
};

/**
 * confirmOrderPayment hook, BEFORE its transaction (unlocked fast path): a payment for an order that
 * is failed / cancelled, or whose request no longer points at it / is not checking_out, is recorded
 * as needs_review and must not be confirmed. Returns true when it was handled here.
 */
export const handleLateWeightedPayment = async (order: any, info: WeightedPaymentInfo): Promise<boolean> => {
    const [request] = await db
        .select({ id: weightRequests.id, status: weightRequests.status, orderId: weightRequests.orderId })
        .from(weightRequests)
        .where(eq(weightRequests.orderId, order.id))
        .limit(1);
    const decision = decideWeightedPaymentSuccess({
        order: { id: order.id, paymentStatus: order.paymentStatus, status: order.status },
        request: request ?? null,
    });
    if (decision !== "needs_review") return false;
    await db.transaction(async (tx) => recordNeedsReview(tx, order, request ?? null, info));
    return true;
};

/**
 * confirmOrderPayment hook, at the START of its transaction. Locks request + order, re-validates,
 * then claims the confirmation with a conditional update (pending_payment → paid). Only "confirm"
 * lets the existing body continue; "already_paid" (0 rows: someone else confirmed) and
 * "needs_review" (state changed since the fast path) stop it.
 */
export const claimWeightedConfirmationInTx = async (
    tx: any,
    orderId: string,
    info: WeightedPaymentInfo,
    now: Date
): Promise<"confirm" | "already_paid" | "needs_review"> => {
    const [request] = await tx.select().from(weightRequests).where(eq(weightRequests.orderId, orderId)).for("update");
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) return "already_paid";

    const decision = decideWeightedPaymentSuccess({
        order: { id: order.id, paymentStatus: order.paymentStatus, status: order.status },
        request: request ? { orderId: request.orderId, status: request.status } : null,
    });
    if (decision === "already_paid") return "already_paid";
    if (decision === "needs_review") {
        await recordNeedsReview(tx, order, request ?? null, info);
        return "needs_review";
    }

    const claimed = await tx
        .update(orders)
        .set({ paymentStatus: "paid", updatedAt: now })
        .where(and(eq(orders.id, orderId), eq(orders.paymentStatus, "pending_payment")));
    return affectedRows(claimed) === 1 ? "confirm" : "already_paid";
};

/** confirmOrderPayment hook, at the END of its transaction: checking_out → approved. */
export const approveWeightRequestInTx = async (tx: any, orderId: string, now: Date): Promise<void> => {
    await tx
        .update(weightRequests)
        .set({ status: "approved", checkoutStartedAt: null, updatedAt: now })
        .where(and(eq(weightRequests.orderId, orderId), eq(weightRequests.status, "checking_out")));
};

// ─────────────────────────────────────────────
// Failure hooks (recordFailedPayment)
// ─────────────────────────────────────────────

export type WeightedFailureGate = {
    outcome: ReturnType<typeof decideWeightedPaymentFailure>;
    request: any | null;
    order: any | null;
};

/**
 * recordFailedPayment hook, at the START of its transaction: locks order + request and decides.
 * "ignore" (order already paid / past pending / already failed) means the existing body must not run.
 */
export const weightedFailureGateInTx = async (tx: any, orderId: string): Promise<WeightedFailureGate> => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    const [request] = await tx.select().from(weightRequests).where(eq(weightRequests.orderId, orderId)).for("update");
    if (!order) return { outcome: "ignore", request: null, order: null };
    const outcome = decideWeightedPaymentFailure({
        order: { id: order.id, paymentStatus: order.paymentStatus, status: order.status },
        request: request ? { orderId: request.orderId, status: request.status, paymentAttempts: request.paymentAttempts ?? 0 } : null,
    });
    return { outcome, request: request ?? null, order };
};

/**
 * recordFailedPayment hook, at the END of its transaction: revert the request (attempts + 1, fresh
 * customer window) or expire it at MAX_PAYMENT_ATTEMPTS. Returns the expiry to notify AFTER commit.
 */
export const applyWeightedFailureToRequestInTx = async (
    tx: any,
    gate: WeightedFailureGate,
    now: Date
): Promise<{ userId: string; requestId: string } | null> => {
    if (gate.outcome === "revert") {
        await revertWeightRequestInTx(tx, gate.request, { incrementAttempts: true, now });
    } else if (gate.outcome === "expire") {
        const changed = await expireWeightRequestInTx(tx, gate.request.id, `payment failed ${MAX_PAYMENT_ATTEMPTS} times`, now);
        if (changed) return { userId: gate.order.userId, requestId: gate.request.id };
    }
    return null;
};

// ─────────────────────────────────────────────
// Request transitions (shared with checkout re-try and the cron)
// ─────────────────────────────────────────────

/** Back to awaiting_customer_approval with a fresh customer window; weighted rows stay locked. */
export const revertWeightRequestInTx = async (
    tx: any,
    request: { id: string; restaurantId: string },
    opts: { incrementAttempts: boolean; now: Date }
) => {
    const [settings] = await tx
        .select({ weightCustomerTimeoutMin: restaurantSettings.weightCustomerTimeoutMin })
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, request.restaurantId))
        .limit(1);
    // Fallback when the restaurant has no settings row: the agreed 15 minutes.
    const timeoutMin = settings?.weightCustomerTimeoutMin ?? DEFAULT_WEIGHT_CUSTOMER_TIMEOUT_MIN;
    await tx
        .update(weightRequests)
        .set({
            status: "awaiting_customer_approval",
            expiresAt: new Date(opts.now.getTime() + timeoutMin * 60 * 1000),
            checkoutStartedAt: null,
            ...(opts.incrementAttempts ? { paymentAttempts: sql`${weightRequests.paymentAttempts} + 1` } : {}),
            updatedAt: opts.now,
        })
        .where(and(eq(weightRequests.id, request.id), eq(weightRequests.status, "checking_out")));
};

/**
 * Expire with the normal cleanup (restaurant rows deleted, customer rows unlocked and reset).
 * The cleanup runs ONLY if the conditional update actually changed the request. Returns that.
 */
export const expireWeightRequestInTx = async (tx: any, requestId: string, reason: string, now: Date): Promise<boolean> => {
    const result = await tx
        .update(weightRequests)
        .set({
            status: "expired",
            cancelReason: reason,
            checkoutStartedAt: null,
            paymentAttempts: sql`${weightRequests.paymentAttempts} + 1`,
            updatedAt: now,
        })
        .where(and(eq(weightRequests.id, requestId), eq(weightRequests.status, "checking_out")));
    if (affectedRows(result) !== 1) return false;
    await tx.delete(cartItems).where(and(eq(cartItems.weightRequestId, requestId), eq(cartItems.addedBy, "restaurant")));
    await tx
        .update(cartItems)
        .set({ weightRequestId: null, finalWeight: null, isUnavailable: false, updatedAt: now })
        .where(and(eq(cartItems.weightRequestId, requestId), eq(cartItems.addedBy, "customer")));
    return true;
};

/**
 * Marks an unpaid weighted order failed WITHOUT a gateway response (abandoned / superseded attempt:
 * checkout re-try; the Restaurant cron has its own copy) and moves its request back, or expires it at
 * MAX_PAYMENT_ATTEMPTS. Same order / coupon effects as recordFailedPayment, no payment_transactions row
 * (there is no gateway result). Caller holds the transaction with order + request locked FOR UPDATE.
 */
export const failWeightedOrderInTx = async (
    tx: any,
    order: any,
    request: any | null,
    opts: { failureReason: string; now: Date }
): Promise<{ outcome: ReturnType<typeof decideWeightedPaymentFailure>; userId: string; requestId: string | null; expired: boolean }> => {
    const outcome = decideWeightedPaymentFailure({
        order: { id: order.id, paymentStatus: order.paymentStatus, status: order.status },
        request: request ? { orderId: request.orderId, status: request.status, paymentAttempts: request.paymentAttempts ?? 0 } : null,
    });
    const result = { outcome, userId: order.userId as string, requestId: (request?.id as string) ?? null, expired: false };
    if (outcome === "ignore") return result;

    await tx
        .update(orders)
        .set({
            status: "failed",
            paymentStatus: "payment_failed",
            paymentFailureReason: opts.failureReason,
            updatedAt: opts.now,
        })
        .where(and(eq(orders.id, order.id), eq(orders.paymentStatus, "pending_payment")));

    const [usage] = await tx.select().from(couponUsages).where(eq(couponUsages.orderId, order.id)).limit(1);
    if (usage) {
        await tx.delete(couponUsages).where(eq(couponUsages.id, usage.id));
        if (usage.couponId) {
            await tx.update(coupons).set({ usedCount: sql`GREATEST(used_count - 1, 0)` }).where(eq(coupons.id, usage.couponId));
        }
    }

    if (outcome === "revert") {
        await revertWeightRequestInTx(tx, request, { incrementAttempts: true, now: opts.now });
    } else if (outcome === "expire") {
        result.expired = await expireWeightRequestInTx(tx, request.id, `payment failed ${MAX_PAYMENT_ATTEMPTS} times`, opts.now);
    }
    return result;
};

export const notifyWeightRequestExpiredAfterPayments = async (userId: string, requestId: string) => {
    try {
        await sendPushNotification({
            recipientType: "user",
            recipientId: userId,
            title: "تم إلغاء طلب الوزن ❌",
            body: `فشل الدفع ${MAX_PAYMENT_ATTEMPTS} مرات، تم إلغاء طلب الوزن. يمكنك إرسال السلة للوزن مرة أخرى.`,
            data: { type: "weight_request_expired", weightRequestId: requestId, reason: "payment_failed" },
        });
    } catch (err) {
        console.warn(`[WeightPayment] expiry notification failed for request ${requestId}:`, err);
    }
};

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
export async function resolveCheckingOutRequest(requestId: string): Promise<void> {
    const now = new Date();
    let thrown: Error | null = null;
    let expired: { userId: string; requestId: string } | null = null;

    await db.transaction(async (tx) => {
        const [request] = await tx.select().from(weightRequests).where(eq(weightRequests.id, requestId)).for("update");
        if (!request || request.status !== "checking_out") return; // someone else moved it on
        const [order] = request.orderId
            ? await tx.select().from(orders).where(eq(orders.id, request.orderId)).for("update")
            : [null];

        const decision = decideCheckoutRetry({
            checkoutStartedAt: request.checkoutStartedAt,
            order: order ? { paymentStatus: order.paymentStatus, status: order.status, createdAt: order.createdAt } : null,
            now,
        });

        if (decision === "in_progress") {
            thrown = new WeightPaymentInProgressError(request.id);
            return;
        }
        if (decision === "already_paid") {
            thrown = new BadRequest("This order has already been paid.");
            return;
        }
        if (decision === "fail_old_order") {
            const r = await failWeightedOrderInTx(tx, order, request, {
                failureReason: "Abandoned: the customer started a new checkout",
                now,
            });
            if (r.expired) expired = { userId: r.userId, requestId: request.id };
            return;
        }
        // revert_claim / revert_after_failed_order
        await revertWeightRequestInTx(tx, request, { incrementAttempts: false, now });
    });

    if (thrown) throw thrown;
    if (expired) {
        const e = expired as { userId: string; requestId: string };
        await notifyWeightRequestExpiredAfterPayments(e.userId, e.requestId);
        throw new BadRequest(`Payment failed ${MAX_PAYMENT_ATTEMPTS} times, so the weighing request was cancelled. Please send your cart for weighing again.`);
    }
}

/**
 * Moves the request awaiting_customer_approval → checking_out (conditional update: one concurrent
 * checkout wins). `assertCartUnchanged` re-checks the cart under the same lock.
 * Clears order_id so the claim is never confused with an older (failed) order of the same request.
 */
export async function claimWeightCheckout(
    requestId: string,
    assertCartUnchanged: (tx: any, lockedRequestId: string) => Promise<void>
): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
        const [request] = await tx.select().from(weightRequests).where(eq(weightRequests.id, requestId)).for("update");
        if (!request) throw new BadRequest("Weighing request is no longer valid.");
        if (request.status === "checking_out") throw new WeightPaymentInProgressError(request.id, "Checkout already in progress.");
        if (request.status !== "awaiting_customer_approval") {
            throw new BadRequest("Weighing request is no longer valid or has already been checked out.");
        }
        if (new Date(request.expiresAt) <= now) {
            throw new BadRequest("The weighing approval has expired. Please send your cart for weighing again.");
        }
        await assertCartUnchanged(tx, request.id);

        const result = await tx
            .update(weightRequests)
            .set({ status: "checking_out", checkoutStartedAt: now, orderId: null, updatedAt: now })
            .where(and(eq(weightRequests.id, request.id), eq(weightRequests.status, "awaiting_customer_approval")));
        if (affectedRows(result) !== 1) throw new WeightPaymentInProgressError(request.id, "Checkout already in progress.");
    });
}

/** Undo a claim whose session or order transaction failed (no order was created). */
export async function releaseWeightCheckoutClaim(requestId: string): Promise<void> {
    try {
        await db
            .update(weightRequests)
            .set({ status: "awaiting_customer_approval", checkoutStartedAt: null, updatedAt: new Date() })
            .where(and(
                eq(weightRequests.id, requestId),
                eq(weightRequests.status, "checking_out"),
                isNull(weightRequests.orderId)
            ));
    } catch (err) {
        // The cron reverts a claim without an order after CHECKOUT_NO_ORDER_MINUTES anyway.
        console.error(`[WeightCheckout] failed to release claim ${requestId}:`, err);
    }
}
