// Cart rules for the weight-based ordering flow (customer side).
//
// The decision functions here are pure so they can be unit-tested and shared by
// cart.ts, weightRequests.ts and order.ts (getCart's canCheckout and checkout use
// the SAME evaluateWeightedCheckout(), so the two can never disagree).

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../models/connection";
import { weightRequests } from "../models/schema";
import { BadRequest } from "../Errors/BadRequest";
import { CodedConflictError } from "../Errors/codedConflictError";
import { computeWeightedLineTotal, snapshotLinePricing, type WeightedOptionExtra } from "./weightPricing.helper";

export type WeightRequestStatus =
    | "awaiting_weighing"
    | "awaiting_customer_approval"
    | "checking_out"
    | "approved"
    | "cancelled"
    | "expired";

/** Statuses during which a request "owns" the customer's weighted cart rows. */
export const ACTIVE_WEIGHT_REQUEST_STATUSES: WeightRequestStatus[] = [
    "awaiting_weighing",
    "awaiting_customer_approval",
];

/**
 * Statuses during which EVERY cart write is rejected (normal items included):
 * the Visa payment amount is fixed while the request is checking_out.
 */
export const FROZEN_CART_STATUSES: WeightRequestStatus[] = ["checking_out"];

// ─── Visa checkout windows (weighted orders only) ────────────────────────────
/** A second checkout click younger than this is treated as a double click ("payment in progress"). */
export const CHECKOUT_RETRY_MIN_AGE_MINUTES = 2;
/** A checking_out claim without an order older than this is stale (the cron reverts it). */
export const CHECKOUT_NO_ORDER_MINUTES = 5;
/** A weighted Visa order still pending_payment after this is abandoned; also the Kashier session lifetime. */
export const PAYMENT_ABANDON_MINUTES = 30;
/** Failed / abandoned payment attempts after which the request expires. */
export const MAX_PAYMENT_ATTEMPTS = 3;
/** Fallback when restaurant_settings has no row: the agreed 15 minutes. */
export const DEFAULT_WEIGHT_CUSTOMER_TIMEOUT_MIN = 15;

export interface ActiveWeightRequest {
    id: string;
    status: WeightRequestStatus | string;
    expiresAt: Date | string;
}

export interface WeightCartRow {
    id?: string;
    weight?: unknown;
    weightRequestId?: string | null;
    addedBy?: "customer" | "restaurant" | string | null;
    isUnavailable?: boolean | null;
}

export const WEIGHT_REQUEST_ACTIVE = "WEIGHT_REQUEST_ACTIVE";
export const WEIGHT_CART_CHANGED = "WEIGHT_CART_CHANGED";

export class WeightRequestActiveError extends CodedConflictError {
    constructor(requestId: string, message: string) {
        super(WEIGHT_REQUEST_ACTIVE, message, { requestId });
    }
}

export const WEIGHT_PAYMENT_IN_PROGRESS = "WEIGHT_PAYMENT_IN_PROGRESS";

export class WeightPaymentInProgressError extends CodedConflictError {
    constructor(requestId: string, message = "A payment for this order is already in progress. Please finish it or try again in a few minutes.") {
        super(WEIGHT_PAYMENT_IN_PROGRESS, message, { requestId });
    }
}

export class WeightCartChangedError extends CodedConflictError {
    constructor(requestId: string, cartItemIds: string[]) {
        super(
            WEIGHT_CART_CHANGED,
            "Your cart changed after it was sent to the restaurant, please send it again.",
            { requestId, cartItemIds }
        );
    }
}

/** A row that needs restaurant weighing (weight-sold food or a stored weight). */
export const isWeighedRow = (row: WeightCartRow, foodSoldBy?: string | null): boolean =>
    foodSoldBy === "weight" || (row.weight !== undefined && row.weight !== null);

/**
 * A row that may only be ordered through an approved weight request:
 * every weighted row and every restaurant-added row.
 */
export const isWeightBoundRow = (row: WeightCartRow, foodSoldBy?: string | null): boolean =>
    isWeighedRow(row, foodSoldBy) || row.addedBy === "restaurant";

/** Active (or frozen) weight request of a user for a restaurant, if any. */
export const findActiveWeightRequest = async (
    userId: string,
    restaurantId: string,
    executor: any = db
): Promise<ActiveWeightRequest | null> => {
    const [row] = await executor
        .select({ id: weightRequests.id, status: weightRequests.status, expiresAt: weightRequests.expiresAt })
        .from(weightRequests)
        .where(
            and(
                eq(weightRequests.userId, userId),
                eq(weightRequests.restaurantId, restaurantId),
                inArray(weightRequests.status, [...ACTIVE_WEIGHT_REQUEST_STATUSES, ...FROZEN_CART_STATUSES] as any)
            )
        )
        .limit(1);
    return row ?? null;
};

export type CartWriteKind = "add" | "update" | "remove" | "clear";

/**
 * Decides whether a customer cart write is allowed. Throws WeightRequestActiveError (409).
 *
 * - Frozen request (checking_out): every write rejected, normal items included.
 * - Row locked to a request (weight_request_id set): rejected.
 * - Restaurant-added row: never editable by the customer while a request is active.
 * - Weighted food / weighted row while a request is active: rejected.
 * - Normal (unit) items while a request is awaiting_weighing / awaiting_customer_approval: allowed.
 */
export const assertCartWriteAllowed = (params: {
    kind: CartWriteKind;
    activeRequest: ActiveWeightRequest | null;
    /** true when the target is a weighted food/row or a restaurant-added row */
    targetIsWeightBound: boolean;
    /** weight_request_id of the targeted row (update/remove) */
    rowWeightRequestId?: string | null;
    /** for clear: weight_request_id of any locked row in the cart */
    lockedRowRequestId?: string | null;
}): void => {
    const { kind, activeRequest, targetIsWeightBound, rowWeightRequestId, lockedRowRequestId } = params;

    if (activeRequest && (FROZEN_CART_STATUSES as string[]).includes(activeRequest.status)) {
        throw new WeightRequestActiveError(
            activeRequest.id,
            "Your order is being paid. The cart cannot be changed until the payment finishes."
        );
    }

    if (rowWeightRequestId) {
        throw new WeightRequestActiveError(
            rowWeightRequestId,
            "This item is part of a weighing request. Cancel the request to change it."
        );
    }

    if (kind === "clear" && lockedRowRequestId) {
        throw new WeightRequestActiveError(
            activeRequest?.id ?? lockedRowRequestId,
            "Your cart has items in a weighing request. Cancel the request before clearing the cart."
        );
    }

    if (activeRequest && (targetIsWeightBound || kind === "clear")) {
        throw new WeightRequestActiveError(
            activeRequest.id,
            "You have an active weighing request. Cancel it to change weight-based items, then send the cart again."
        );
    }
};

/**
 * Checkout gate for carts with weight-bound rows. Shared by checkout and getCart.canCheckout.
 *
 * - No weight-bound rows: returns every row unchanged (normal checkout, exactly as before).
 * - Otherwise requires a request in awaiting_customer_approval that is not expired, and EVERY
 *   weight-bound row (and every row tagged with any request) must carry `request.id`.
 *   Any other row means the cart changed after it was sent → WeightCartChangedError; never
 *   silently included or dropped.
 * - Rows marked is_unavailable by the restaurant are excluded.
 */
export const evaluateWeightedCheckout = <R extends WeightCartRow>(
    rows: Array<R & { foodSoldBy?: string | null }>,
    request: ActiveWeightRequest | null,
    now: Date = new Date()
): { hasWeightedItems: boolean; checkoutRows: R[] } => {
    const hasWeightedItems = rows.some((r) => isWeightBoundRow(r, r.foodSoldBy));
    if (!hasWeightedItems) {
        return { hasWeightedItems: false, checkoutRows: rows };
    }

    if (!request) {
        throw new BadRequest("Cart contains weight-based items. Please send the order to the restaurant for weighing first.");
    }
    if (request.status === "awaiting_weighing") {
        throw new BadRequest("Your order is currently awaiting weighing by the restaurant.");
    }
    if (request.status === "checking_out") {
        throw new WeightPaymentInProgressError(request.id);
    }
    if (request.status !== "awaiting_customer_approval") {
        throw new BadRequest("Cart contains weight-based items. Please send the order to the restaurant for weighing first.");
    }
    if (new Date(request.expiresAt) <= now) {
        throw new BadRequest("The weighing approval has expired. Please send your cart for weighing again.");
    }

    const strayRows = rows.filter((r) =>
        (isWeightBoundRow(r, r.foodSoldBy) && r.weightRequestId !== request.id) ||
        (r.weightRequestId && r.weightRequestId !== request.id)
    );
    if (strayRows.length > 0) {
        throw new WeightCartChangedError(request.id, strayRows.map((r) => String(r.id ?? "")));
    }

    const checkoutRows = rows.filter((r) => !r.isUnavailable);
    if (checkoutRows.length === 0) {
        throw new BadRequest("All items in your cart are marked as unavailable.");
    }

    return { hasWeightedItems: true, checkoutRows };
};

export const canCheckoutWeightedCart = (
    rows: Array<WeightCartRow & { foodSoldBy?: string | null }>,
    request: ActiveWeightRequest | null,
    now: Date = new Date()
): boolean => {
    try {
        evaluateWeightedCheckout(rows, request, now);
        return true;
    } catch {
        return false;
    }
};

// ─────────────────────────────────────────────
// Snapshot pricing of weight-bound rows
// ─────────────────────────────────────────────

const parseMaybeJson = (raw: any): any => {
    let v = raw;
    for (let i = 0; i < 3 && typeof v === "string"; i++) {
        try { v = JSON.parse(v); } catch { break; }
    }
    return v;
};

/** Variations snapshot stored in cart_items.variations ({variations:[...]} or a bare array). */
export const parseVariationSnapshot = (raw: any): any[] => {
    const v = parseMaybeJson(raw);
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object" && Array.isArray(v.variations)) return v.variations;
    return [];
};

export const parseAddonSnapshot = (raw: any): any[] => {
    const v = parseMaybeJson(raw);
    return Array.isArray(v) ? v : [];
};

export const variationExtrasFromSnapshot = (vars: any[]): WeightedOptionExtra[] =>
    vars.map((v: any) => ({
        price: Number(v.price ?? v.additionalPrice ?? 0),
        priceMode: v.priceMode === "per_weight" ? "per_weight" : "fixed",
    }));

export const addonExtrasFromSnapshot = (addonList: any[]): WeightedOptionExtra[] =>
    addonList.map((a: any) => ({ price: Number(a.price ?? 0), priceMode: "fixed" }));

/**
 * Price snapshot of a weight-bound row (the price the customer saw when sending the cart,
 * or the price the restaurant set while weighing). Used at checkout and by getCart for
 * locked rows so that the order total equals the cart total.
 *
 * - Weighted row: cart_items.unit_price is the base price per weight unit.
 * - Restaurant-added unit row: cart_items.unit_price is base + variations + addons per unit.
 */
export const snapshotPricing = (row: {
    weight?: unknown;
    unitPrice?: string | number | null;
    variations?: unknown;
    addons?: unknown;
}, isWeighted: boolean) => snapshotLinePricing(row, isWeighted);

/**
 * priceChanged rule shared by getCart and checkout. For weighted rows cart_items.unit_price is the
 * base price per weight unit, so only the live base price is compared (comparing base + variants +
 * addons would flag every weighted row that has options).
 */
export const hasUnitPriceChanged = (p: {
    isWeighted: boolean;
    liveBasePrice: number;
    liveTotalUnitPrice: number;
    storedUnitPrice: number;
    tolerance?: number;
}): boolean => {
    const live = p.isWeighted ? p.liveBasePrice : p.liveTotalUnitPrice;
    return Math.abs(live - p.storedUnitPrice) > (p.tolerance ?? 0.001);
};

/** Line total for a weighted row (final weight if set, else the ordered weight). */
export const weightedLineTotal = (
    effectiveWeight: number | string,
    basePrice: number,
    variationExtras: WeightedOptionExtra[],
    addonExtras: WeightedOptionExtra[]
): number => parseFloat(computeWeightedLineTotal(effectiveWeight, basePrice, [...variationExtras, ...addonExtras]));

// ─────────────────────────────────────────────
// Re-checkout while a Visa claim exists (status checking_out)
// ─────────────────────────────────────────────

export type CheckoutRetryDecision =
    /** double click / payment page may still be open: reject, never touch the first order */
    | "in_progress"
    /** claim never got an order and is old enough: revert the claim, then check out normally */
    | "revert_claim"
    /** old unpaid order is old enough: fail it (weighted path), revert, then check out again */
    | "fail_old_order"
    /** old order is already paid: nothing to retry */
    | "already_paid"
    /** old order is already failed / cancelled: just revert the claim */
    | "revert_after_failed_order";

const minutesBetween = (from: Date | string | null | undefined, now: Date) =>
    from ? (now.getTime() - new Date(from).getTime()) / 60000 : Number.POSITIVE_INFINITY;

/**
 * Pure decision for a checkout attempt that finds the request in checking_out.
 * The age is measured from the order's creation (or the claim's start when no order exists yet).
 */
export const decideCheckoutRetry = (p: {
    checkoutStartedAt: Date | string | null;
    order: { paymentStatus: string | null; status: string | null; createdAt: Date | string | null } | null;
    now?: Date;
}): CheckoutRetryDecision => {
    const now = p.now ?? new Date();
    if (!p.order) {
        return minutesBetween(p.checkoutStartedAt, now) < CHECKOUT_RETRY_MIN_AGE_MINUTES ? "in_progress" : "revert_claim";
    }
    if (p.order.paymentStatus === "paid") return "already_paid";
    if (p.order.paymentStatus === "payment_failed" || p.order.status === "failed" || p.order.status === "cancelled") {
        return "revert_after_failed_order";
    }
    return minutesBetween(p.order.createdAt, now) < CHECKOUT_RETRY_MIN_AGE_MINUTES ? "in_progress" : "fail_old_order";
};

/**
 * Pure decision for a successful payment of an order that belongs to a weight request.
 * - "already_paid": idempotent no-op (gateway retry, redirect + webhook).
 * - "confirm": the request still points at this order and is checking_out.
 * - "needs_review": late payment (request reverted / expired / cancelled / moved to another order,
 *   or the order was already failed / cancelled): record it for a manual refund, never confirm.
 */
export const decideWeightedPaymentSuccess = (p: {
    order: { id: string; paymentStatus: string | null; status: string | null };
    request: { orderId: string | null; status: string } | null;
}): "already_paid" | "confirm" | "needs_review" => {
    if (p.order.paymentStatus === "paid") return "already_paid";
    if (p.order.status === "failed" || p.order.status === "cancelled" || p.order.paymentStatus === "payment_failed") {
        return "needs_review";
    }
    // Already past "pending" (accepted, preparing, ...) means it was confirmed before; a later
    // webhook (e.g. Paymob "pending" that rewrote payment_status) must not confirm it twice.
    if (p.order.status && p.order.status !== "pending") return "already_paid";
    if (p.request && p.request.orderId === p.order.id && p.request.status === "checking_out") return "confirm";
    return "needs_review";
};

/**
 * Pure decision for a failed / rejected / cancelled payment of a weighted order.
 * - "ignore": order already paid / past pending (never overwrite) or already failed (gateway retry).
 * - "fail_order_only": the request no longer points at this order (or isn't checking_out).
 * - "revert": request back to awaiting_customer_approval, attempts + 1.
 * - "expire": the attempt limit is reached: expire with the normal cleanup.
 */
export const decideWeightedPaymentFailure = (p: {
    order: { id: string; paymentStatus: string | null; status?: string | null };
    request: { orderId: string | null; status: string; paymentAttempts: number } | null;
}): "ignore" | "fail_order_only" | "revert" | "expire" => {
    if (p.order.paymentStatus === "paid" || p.order.paymentStatus === "payment_failed") return "ignore";
    // Never overwrite an order that left "pending" (paid & accepted, or already failed / cancelled).
    if (p.order.status && p.order.status !== "pending") return "ignore";
    if (!p.request || p.request.orderId !== p.order.id || p.request.status !== "checking_out") return "fail_order_only";
    return p.request.paymentAttempts + 1 >= MAX_PAYMENT_ATTEMPTS ? "expire" : "revert";
};
