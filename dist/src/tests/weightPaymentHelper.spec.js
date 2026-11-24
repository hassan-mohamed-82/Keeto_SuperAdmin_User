"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const h = vitest_1.vi.hoisted(() => {
    const writes = [];
    const state = { queue: [], affected: [] };
    const chain = (result) => {
        const c = {};
        for (const m of ["from", "where", "limit", "for"])
            c[m] = () => c;
        c.then = (res, rej) => Promise.resolve(result).then(res, rej);
        return c;
    };
    const fakeTx = {
        select: () => chain(state.queue.shift() ?? []),
        update: (table) => ({ set: (values) => ({ where: async () => {
                    writes.push({ op: "update", table, values });
                    return [{ affectedRows: state.affected.length ? state.affected.shift() : 1 }];
                } }) }),
        insert: (table) => ({ values: async (values) => { writes.push({ op: "insert", table, values }); } }),
        delete: (table) => ({ where: async () => { writes.push({ op: "delete", table }); } }),
        transaction: async (cb) => cb(fakeTx),
    };
    return { writes, state, fakeTx };
});
vitest_1.vi.mock("../models/connection", () => ({ db: h.fakeTx }));
vitest_1.vi.mock("../utils/notifications", () => ({ sendPushNotification: vitest_1.vi.fn(async () => undefined) }));
const weightPayment_helper_1 = require("../helpers/weightPayment.helper");
const weightCart_helper_1 = require("../helpers/weightCart.helper");
const schema_1 = require("../models/schema");
const NOW = new Date("2026-11-15T12:00:00Z");
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000);
const pending = { paymentStatus: "pending_payment", status: "pending" };
(0, vitest_1.beforeEach)(() => {
    h.writes.length = 0;
    h.state.queue = [];
    h.state.affected = [];
});
(0, vitest_1.describe)("re-checkout while checking_out (CHECKOUT_RETRY_MIN_AGE_MINUTES)", () => {
    (0, vitest_1.it)("double click: a second checkout seconds later is 'in progress', never fails the first order", () => {
        (0, vitest_1.expect)((0, weightCart_helper_1.decideCheckoutRetry)({ checkoutStartedAt: minutesAgo(0.05), order: null, now: NOW })).toBe("in_progress");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideCheckoutRetry)({ checkoutStartedAt: minutesAgo(0.1), order: { ...pending, createdAt: minutesAgo(0.05) }, now: NOW }))
            .toBe("in_progress");
    });
    (0, vitest_1.it)("just below the threshold: still in progress", () => {
        const age = weightCart_helper_1.CHECKOUT_RETRY_MIN_AGE_MINUTES - 0.01;
        (0, vitest_1.expect)((0, weightCart_helper_1.decideCheckoutRetry)({ checkoutStartedAt: minutesAgo(age), order: { ...pending, createdAt: minutesAgo(age) }, now: NOW }))
            .toBe("in_progress");
    });
    (0, vitest_1.it)("at / above the threshold: the old unpaid order is failed and the request reverted", () => {
        const age = weightCart_helper_1.CHECKOUT_RETRY_MIN_AGE_MINUTES;
        (0, vitest_1.expect)((0, weightCart_helper_1.decideCheckoutRetry)({ checkoutStartedAt: minutesAgo(age), order: { ...pending, createdAt: minutesAgo(age) }, now: NOW }))
            .toBe("fail_old_order");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideCheckoutRetry)({ checkoutStartedAt: minutesAgo(10), order: null, now: NOW })).toBe("revert_claim");
    });
    (0, vitest_1.it)("paid / failed old orders", () => {
        (0, vitest_1.expect)((0, weightCart_helper_1.decideCheckoutRetry)({ checkoutStartedAt: minutesAgo(10), order: { paymentStatus: "paid", status: "accepted", createdAt: minutesAgo(10) }, now: NOW }))
            .toBe("already_paid");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideCheckoutRetry)({ checkoutStartedAt: minutesAgo(10), order: { paymentStatus: "payment_failed", status: "failed", createdAt: minutesAgo(10) }, now: NOW }))
            .toBe("revert_after_failed_order");
    });
    (0, vitest_1.it)("checkout gate: a checking_out request gives 'payment in progress'; every cart write is frozen", () => {
        const rows = [{ id: "w1", weight: "0.5", weightRequestId: "r1", addedBy: "customer", isUnavailable: false, foodSoldBy: "weight" }];
        (0, vitest_1.expect)(() => (0, weightCart_helper_1.evaluateWeightedCheckout)(rows, { id: "r1", status: "checking_out", expiresAt: minutesAgo(-10) }, NOW))
            .toThrow(weightCart_helper_1.WeightPaymentInProgressError);
        (0, vitest_1.expect)(weightCart_helper_1.FROZEN_CART_STATUSES).toEqual(["checking_out"]);
        (0, vitest_1.expect)(() => (0, weightCart_helper_1.assertCartWriteAllowed)({ kind: "add", activeRequest: { id: "r1", status: "checking_out", expiresAt: NOW }, targetIsWeightBound: false }))
            .toThrow(/payment/i);
    });
});
(0, vitest_1.describe)("payment decisions (weighted)", () => {
    const req = (over = {}) => ({ orderId: "o1", status: "checking_out", paymentAttempts: 0, ...over });
    (0, vitest_1.it)("success", () => {
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentSuccess)({ order: { id: "o1", ...pending }, request: req() })).toBe("confirm");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentSuccess)({ order: { id: "o1", paymentStatus: "paid", status: "accepted" }, request: req() })).toBe("already_paid");
        // late payments
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentSuccess)({ order: { id: "o1", ...pending }, request: req({ status: "awaiting_customer_approval" }) })).toBe("needs_review");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentSuccess)({ order: { id: "o1", ...pending }, request: req({ status: "expired" }) })).toBe("needs_review");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentSuccess)({ order: { id: "o1", ...pending }, request: req({ orderId: "o2" }) })).toBe("needs_review");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentSuccess)({ order: { id: "o1", ...pending }, request: null })).toBe("needs_review");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentSuccess)({ order: { id: "o1", paymentStatus: "payment_failed", status: "failed" }, request: req() })).toBe("needs_review");
    });
    (0, vitest_1.it)("failure: never overwrite a paid order; revert; expire on the 3rd failure", () => {
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentFailure)({ order: { id: "o1", paymentStatus: "paid", status: "accepted" }, request: req() })).toBe("ignore");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentFailure)({ order: { id: "o1", paymentStatus: "pending_payment", status: "accepted" }, request: req() })).toBe("ignore");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentFailure)({ order: { id: "o1", ...pending }, request: req() })).toBe("revert");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentFailure)({ order: { id: "o1", ...pending }, request: req({ paymentAttempts: 1 }) })).toBe("revert");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentFailure)({ order: { id: "o1", ...pending }, request: req({ paymentAttempts: 2 }) })).toBe("expire");
        (0, vitest_1.expect)((0, weightCart_helper_1.decideWeightedPaymentFailure)({ order: { id: "o1", ...pending }, request: req({ orderId: "o2" }) })).toBe("fail_order_only");
    });
});
(0, vitest_1.describe)("weighted hooks / transitions against a fake transaction", () => {
    (0, vitest_1.it)("expireWeightRequestInTx cleans the cart ONLY when its conditional update changed the request", async () => {
        h.state.affected = [0];
        await (0, vitest_1.expect)((0, weightPayment_helper_1.expireWeightRequestInTx)(h.fakeTx, "wr-1", "x", NOW)).resolves.toBe(false);
        (0, vitest_1.expect)(h.writes.map((w) => w.table)).toEqual([schema_1.weightRequests]);
        h.writes.length = 0;
        h.state.affected = [1];
        await (0, vitest_1.expect)((0, weightPayment_helper_1.expireWeightRequestInTx)(h.fakeTx, "wr-1", "x", NOW)).resolves.toBe(true);
        (0, vitest_1.expect)(h.writes.map((w) => [w.op, w.table])).toEqual([
            ["update", schema_1.weightRequests], ["delete", schema_1.cartItems], ["update", schema_1.cartItems],
        ]);
    });
    (0, vitest_1.it)("revertWeightRequestInTx falls back to the agreed 15 minutes when settings are missing", async () => {
        h.state.queue = [[]];
        await (0, weightPayment_helper_1.revertWeightRequestInTx)(h.fakeTx, { id: "wr-1", restaurantId: "r-1" }, { incrementAttempts: true, now: NOW });
        (0, vitest_1.expect)(weightCart_helper_1.DEFAULT_WEIGHT_CUSTOMER_TIMEOUT_MIN).toBe(15);
        (0, vitest_1.expect)(h.writes[0].values.status).toBe("awaiting_customer_approval");
        (0, vitest_1.expect)(h.writes[0].values.expiresAt.getTime() - NOW.getTime()).toBe(15 * 60000);
    });
    (0, vitest_1.it)("claimWeightedConfirmationInTx: conditional claim wins once; a lost claim is 'already_paid'", async () => {
        const order = { id: "o1", ...pending };
        h.state.queue = [[{ id: "wr-1", orderId: "o1", status: "checking_out" }], [order]];
        h.state.affected = [1];
        await (0, vitest_1.expect)((0, weightPayment_helper_1.claimWeightedConfirmationInTx)(h.fakeTx, "o1", { gateway: "kashier" }, NOW)).resolves.toBe("confirm");
        (0, vitest_1.expect)(h.writes[0]).toMatchObject({ op: "update", table: schema_1.orders, values: { paymentStatus: "paid" } });
        h.writes.length = 0;
        h.state.queue = [[{ id: "wr-1", orderId: "o1", status: "checking_out" }], [order]];
        h.state.affected = [0]; // someone else flipped pending_payment → paid first
        await (0, vitest_1.expect)((0, weightPayment_helper_1.claimWeightedConfirmationInTx)(h.fakeTx, "o1", { gateway: "kashier" }, NOW)).resolves.toBe("already_paid");
    });
    (0, vitest_1.it)("claimWeightedConfirmationInTx: request moved on → needs_review recorded once (idempotent)", async () => {
        const order = { id: "o1", orderNumber: "A", userId: "u", restaurantId: "r", totalAmount: "190.00", ...pending };
        h.state.queue = [[{ id: "wr-1", orderId: "o1", status: "expired" }], [order], []];
        await (0, vitest_1.expect)((0, weightPayment_helper_1.claimWeightedConfirmationInTx)(h.fakeTx, "o1", { gateway: "paymob", transactionId: "t1" }, NOW)).resolves.toBe("needs_review");
        (0, vitest_1.expect)(h.writes).toHaveLength(1);
        (0, vitest_1.expect)(h.writes[0]).toMatchObject({ op: "insert", table: schema_1.paymentTransactions, values: { status: "needs_review", transactionId: "t1", amount: "190.00", gateway: "paymob" } });
        h.writes.length = 0;
        h.state.queue = [[{ id: "wr-1", orderId: "o1", status: "expired" }], [order], [{ id: "existing" }]];
        await (0, weightPayment_helper_1.claimWeightedConfirmationInTx)(h.fakeTx, "o1", { gateway: "paymob", transactionId: "t1" }, NOW);
        (0, vitest_1.expect)(h.writes).toHaveLength(0); // gateway retry: no duplicate row
    });
});
