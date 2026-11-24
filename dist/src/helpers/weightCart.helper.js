"use strict";
// Cart rules for the weight-based ordering flow (customer side).
//
// The decision functions here are pure so they can be unit-tested and shared by
// cart.ts, weightRequests.ts and order.ts (getCart's canCheckout and checkout use
// the SAME evaluateWeightedCheckout(), so the two can never disagree).
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideWeightedPaymentFailure = exports.decideWeightedPaymentSuccess = exports.decideCheckoutRetry = exports.weightedLineTotal = exports.hasUnitPriceChanged = exports.snapshotPricing = exports.addonExtrasFromSnapshot = exports.variationExtrasFromSnapshot = exports.parseAddonSnapshot = exports.parseVariationSnapshot = exports.canCheckoutWeightedCart = exports.evaluateWeightedCheckout = exports.assertCartWriteAllowed = exports.findActiveWeightRequest = exports.isWeightBoundRow = exports.isWeighedRow = exports.WeightCartChangedError = exports.WeightPaymentInProgressError = exports.WEIGHT_PAYMENT_IN_PROGRESS = exports.WeightRequestActiveError = exports.WEIGHT_CART_CHANGED = exports.WEIGHT_REQUEST_ACTIVE = exports.DEFAULT_WEIGHT_CUSTOMER_TIMEOUT_MIN = exports.MAX_PAYMENT_ATTEMPTS = exports.PAYMENT_ABANDON_MINUTES = exports.CHECKOUT_NO_ORDER_MINUTES = exports.CHECKOUT_RETRY_MIN_AGE_MINUTES = exports.FROZEN_CART_STATUSES = exports.ACTIVE_WEIGHT_REQUEST_STATUSES = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const BadRequest_1 = require("../Errors/BadRequest");
const codedConflictError_1 = require("../Errors/codedConflictError");
const weightPricing_helper_1 = require("./weightPricing.helper");
/** Statuses during which a request "owns" the customer's weighted cart rows. */
exports.ACTIVE_WEIGHT_REQUEST_STATUSES = [
    "awaiting_weighing",
    "awaiting_customer_approval",
];
/**
 * Statuses during which EVERY cart write is rejected (normal items included):
 * the Visa payment amount is fixed while the request is checking_out.
 */
exports.FROZEN_CART_STATUSES = ["checking_out"];
// ─── Visa checkout windows (weighted orders only) ────────────────────────────
/** A second checkout click younger than this is treated as a double click ("payment in progress"). */
exports.CHECKOUT_RETRY_MIN_AGE_MINUTES = 2;
/** A checking_out claim without an order older than this is stale (the cron reverts it). */
exports.CHECKOUT_NO_ORDER_MINUTES = 5;
/** A weighted Visa order still pending_payment after this is abandoned; also the Kashier session lifetime. */
exports.PAYMENT_ABANDON_MINUTES = 30;
/** Failed / abandoned payment attempts after which the request expires. */
exports.MAX_PAYMENT_ATTEMPTS = 3;
/** Fallback when restaurant_settings has no row: the agreed 15 minutes. */
exports.DEFAULT_WEIGHT_CUSTOMER_TIMEOUT_MIN = 15;
exports.WEIGHT_REQUEST_ACTIVE = "WEIGHT_REQUEST_ACTIVE";
exports.WEIGHT_CART_CHANGED = "WEIGHT_CART_CHANGED";
class WeightRequestActiveError extends codedConflictError_1.CodedConflictError {
    constructor(requestId, message) {
        super(exports.WEIGHT_REQUEST_ACTIVE, message, { requestId });
    }
}
exports.WeightRequestActiveError = WeightRequestActiveError;
exports.WEIGHT_PAYMENT_IN_PROGRESS = "WEIGHT_PAYMENT_IN_PROGRESS";
class WeightPaymentInProgressError extends codedConflictError_1.CodedConflictError {
    constructor(requestId, message = "A payment for this order is already in progress. Please finish it or try again in a few minutes.") {
        super(exports.WEIGHT_PAYMENT_IN_PROGRESS, message, { requestId });
    }
}
exports.WeightPaymentInProgressError = WeightPaymentInProgressError;
class WeightCartChangedError extends codedConflictError_1.CodedConflictError {
    constructor(requestId, cartItemIds) {
        super(exports.WEIGHT_CART_CHANGED, "Your cart changed after it was sent to the restaurant, please send it again.", { requestId, cartItemIds });
    }
}
exports.WeightCartChangedError = WeightCartChangedError;
/** A row that needs restaurant weighing (weight-sold food or a stored weight). */
const isWeighedRow = (row, foodSoldBy) => foodSoldBy === "weight" || (row.weight !== undefined && row.weight !== null);
exports.isWeighedRow = isWeighedRow;
/**
 * A row that may only be ordered through an approved weight request:
 * every weighted row and every restaurant-added row.
 */
const isWeightBoundRow = (row, foodSoldBy) => (0, exports.isWeighedRow)(row, foodSoldBy) || row.addedBy === "restaurant";
exports.isWeightBoundRow = isWeightBoundRow;
/** Active (or frozen) weight request of a user for a restaurant, if any. */
const findActiveWeightRequest = async (userId, restaurantId, executor = connection_1.db) => {
    const [row] = await executor
        .select({ id: schema_1.weightRequests.id, status: schema_1.weightRequests.status, expiresAt: schema_1.weightRequests.expiresAt })
        .from(schema_1.weightRequests)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.weightRequests.userId, userId), (0, drizzle_orm_1.eq)(schema_1.weightRequests.restaurantId, restaurantId), (0, drizzle_orm_1.inArray)(schema_1.weightRequests.status, [...exports.ACTIVE_WEIGHT_REQUEST_STATUSES, ...exports.FROZEN_CART_STATUSES])))
        .limit(1);
    return row ?? null;
};
exports.findActiveWeightRequest = findActiveWeightRequest;
/**
 * Decides whether a customer cart write is allowed. Throws WeightRequestActiveError (409).
 *
 * - Frozen request (checking_out): every write rejected, normal items included.
 * - Row locked to a request (weight_request_id set): rejected.
 * - Restaurant-added row: never editable by the customer while a request is active.
 * - Weighted food / weighted row while a request is active: rejected.
 * - Normal (unit) items while a request is awaiting_weighing / awaiting_customer_approval: allowed.
 */
const assertCartWriteAllowed = (params) => {
    const { kind, activeRequest, targetIsWeightBound, rowWeightRequestId, lockedRowRequestId } = params;
    if (activeRequest && exports.FROZEN_CART_STATUSES.includes(activeRequest.status)) {
        throw new WeightRequestActiveError(activeRequest.id, "Your order is being paid. The cart cannot be changed until the payment finishes.");
    }
    if (rowWeightRequestId) {
        throw new WeightRequestActiveError(rowWeightRequestId, "This item is part of a weighing request. Cancel the request to change it.");
    }
    if (kind === "clear" && lockedRowRequestId) {
        throw new WeightRequestActiveError(activeRequest?.id ?? lockedRowRequestId, "Your cart has items in a weighing request. Cancel the request before clearing the cart.");
    }
    if (activeRequest && (targetIsWeightBound || kind === "clear")) {
        throw new WeightRequestActiveError(activeRequest.id, "You have an active weighing request. Cancel it to change weight-based items, then send the cart again.");
    }
};
exports.assertCartWriteAllowed = assertCartWriteAllowed;
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
const evaluateWeightedCheckout = (rows, request, now = new Date()) => {
    const hasWeightedItems = rows.some((r) => (0, exports.isWeightBoundRow)(r, r.foodSoldBy));
    if (!hasWeightedItems) {
        return { hasWeightedItems: false, checkoutRows: rows };
    }
    if (!request) {
        throw new BadRequest_1.BadRequest("Cart contains weight-based items. Please send the order to the restaurant for weighing first.");
    }
    if (request.status === "awaiting_weighing") {
        throw new BadRequest_1.BadRequest("Your order is currently awaiting weighing by the restaurant.");
    }
    if (request.status === "checking_out") {
        throw new WeightPaymentInProgressError(request.id);
    }
    if (request.status !== "awaiting_customer_approval") {
        throw new BadRequest_1.BadRequest("Cart contains weight-based items. Please send the order to the restaurant for weighing first.");
    }
    if (new Date(request.expiresAt) <= now) {
        throw new BadRequest_1.BadRequest("The weighing approval has expired. Please send your cart for weighing again.");
    }
    const strayRows = rows.filter((r) => ((0, exports.isWeightBoundRow)(r, r.foodSoldBy) && r.weightRequestId !== request.id) ||
        (r.weightRequestId && r.weightRequestId !== request.id));
    if (strayRows.length > 0) {
        throw new WeightCartChangedError(request.id, strayRows.map((r) => String(r.id ?? "")));
    }
    const checkoutRows = rows.filter((r) => !r.isUnavailable);
    if (checkoutRows.length === 0) {
        throw new BadRequest_1.BadRequest("All items in your cart are marked as unavailable.");
    }
    return { hasWeightedItems: true, checkoutRows };
};
exports.evaluateWeightedCheckout = evaluateWeightedCheckout;
const canCheckoutWeightedCart = (rows, request, now = new Date()) => {
    try {
        (0, exports.evaluateWeightedCheckout)(rows, request, now);
        return true;
    }
    catch {
        return false;
    }
};
exports.canCheckoutWeightedCart = canCheckoutWeightedCart;
// ─────────────────────────────────────────────
// Snapshot pricing of weight-bound rows
// ─────────────────────────────────────────────
const parseMaybeJson = (raw) => {
    let v = raw;
    for (let i = 0; i < 3 && typeof v === "string"; i++) {
        try {
            v = JSON.parse(v);
        }
        catch {
            break;
        }
    }
    return v;
};
/** Variations snapshot stored in cart_items.variations ({variations:[...]} or a bare array). */
const parseVariationSnapshot = (raw) => {
    const v = parseMaybeJson(raw);
    if (Array.isArray(v))
        return v;
    if (v && typeof v === "object" && Array.isArray(v.variations))
        return v.variations;
    return [];
};
exports.parseVariationSnapshot = parseVariationSnapshot;
const parseAddonSnapshot = (raw) => {
    const v = parseMaybeJson(raw);
    return Array.isArray(v) ? v : [];
};
exports.parseAddonSnapshot = parseAddonSnapshot;
const variationExtrasFromSnapshot = (vars) => vars.map((v) => ({
    price: Number(v.price ?? v.additionalPrice ?? 0),
    priceMode: v.priceMode === "per_weight" ? "per_weight" : "fixed",
}));
exports.variationExtrasFromSnapshot = variationExtrasFromSnapshot;
const addonExtrasFromSnapshot = (addonList) => addonList.map((a) => ({ price: Number(a.price ?? 0), priceMode: "fixed" }));
exports.addonExtrasFromSnapshot = addonExtrasFromSnapshot;
/**
 * Price snapshot of a weight-bound row (the price the customer saw when sending the cart,
 * or the price the restaurant set while weighing). Used at checkout and by getCart for
 * locked rows so that the order total equals the cart total.
 *
 * - Weighted row: cart_items.unit_price is the base price per weight unit.
 * - Restaurant-added unit row: cart_items.unit_price is base + variations + addons per unit.
 */
const snapshotPricing = (row, isWeighted) => (0, weightPricing_helper_1.snapshotLinePricing)(row, isWeighted);
exports.snapshotPricing = snapshotPricing;
/**
 * priceChanged rule shared by getCart and checkout. For weighted rows cart_items.unit_price is the
 * base price per weight unit, so only the live base price is compared (comparing base + variants +
 * addons would flag every weighted row that has options).
 */
const hasUnitPriceChanged = (p) => {
    const live = p.isWeighted ? p.liveBasePrice : p.liveTotalUnitPrice;
    return Math.abs(live - p.storedUnitPrice) > (p.tolerance ?? 0.001);
};
exports.hasUnitPriceChanged = hasUnitPriceChanged;
/** Line total for a weighted row (final weight if set, else the ordered weight). */
const weightedLineTotal = (effectiveWeight, basePrice, variationExtras, addonExtras, quantity = 1) => parseFloat((0, weightPricing_helper_1.computeWeightedLineTotal)(effectiveWeight, basePrice, [...variationExtras, ...addonExtras], quantity));
exports.weightedLineTotal = weightedLineTotal;
const minutesBetween = (from, now) => from ? (now.getTime() - new Date(from).getTime()) / 60000 : Number.POSITIVE_INFINITY;
/**
 * Pure decision for a checkout attempt that finds the request in checking_out.
 * The age is measured from the order's creation (or the claim's start when no order exists yet).
 */
const decideCheckoutRetry = (p) => {
    const now = p.now ?? new Date();
    if (!p.order) {
        return minutesBetween(p.checkoutStartedAt, now) < exports.CHECKOUT_RETRY_MIN_AGE_MINUTES ? "in_progress" : "revert_claim";
    }
    if (p.order.paymentStatus === "paid")
        return "already_paid";
    if (p.order.paymentStatus === "payment_failed" || p.order.status === "failed" || p.order.status === "cancelled") {
        return "revert_after_failed_order";
    }
    return minutesBetween(p.order.createdAt, now) < exports.CHECKOUT_RETRY_MIN_AGE_MINUTES ? "in_progress" : "fail_old_order";
};
exports.decideCheckoutRetry = decideCheckoutRetry;
/**
 * Pure decision for a successful payment of an order that belongs to a weight request.
 * - "already_paid": idempotent no-op (gateway retry, redirect + webhook).
 * - "confirm": the request still points at this order and is checking_out.
 * - "needs_review": late payment (request reverted / expired / cancelled / moved to another order,
 *   or the order was already failed / cancelled): record it for a manual refund, never confirm.
 */
const decideWeightedPaymentSuccess = (p) => {
    if (p.order.paymentStatus === "paid")
        return "already_paid";
    if (p.order.status === "failed" || p.order.status === "cancelled" || p.order.paymentStatus === "payment_failed") {
        return "needs_review";
    }
    // Already past "pending" (accepted, preparing, ...) means it was confirmed before; a later
    // webhook (e.g. Paymob "pending" that rewrote payment_status) must not confirm it twice.
    if (p.order.status && p.order.status !== "pending")
        return "already_paid";
    if (p.request && p.request.orderId === p.order.id && p.request.status === "checking_out")
        return "confirm";
    return "needs_review";
};
exports.decideWeightedPaymentSuccess = decideWeightedPaymentSuccess;
/**
 * Pure decision for a failed / rejected / cancelled payment of a weighted order.
 * - "ignore": order already paid / past pending (never overwrite) or already failed (gateway retry).
 * - "fail_order_only": the request no longer points at this order (or isn't checking_out).
 * - "revert": request back to awaiting_customer_approval, attempts + 1.
 * - "expire": the attempt limit is reached: expire with the normal cleanup.
 */
const decideWeightedPaymentFailure = (p) => {
    if (p.order.paymentStatus === "paid" || p.order.paymentStatus === "payment_failed")
        return "ignore";
    // Never overwrite an order that left "pending" (paid & accepted, or already failed / cancelled).
    if (p.order.status && p.order.status !== "pending")
        return "ignore";
    if (!p.request || p.request.orderId !== p.order.id || p.request.status !== "checking_out")
        return "fail_order_only";
    return p.request.paymentAttempts + 1 >= exports.MAX_PAYMENT_ATTEMPTS ? "expire" : "revert";
};
exports.decideWeightedPaymentFailure = decideWeightedPaymentFailure;
