import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
    const writes: Array<{ op: string; table: any; values?: any }> = [];
    const state = { queue: [] as any[][], affected: [] as number[] };
    const chain = (result: any) => {
        const c: any = {};
        for (const m of ["from", "where", "limit", "for"]) c[m] = () => c;
        c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
        return c;
    };
    const fakeTx: any = {
        select: () => chain(state.queue.shift() ?? []),
        update: (table: any) => ({ set: (values: any) => ({ where: async () => {
            writes.push({ op: "update", table, values });
            return [{ affectedRows: state.affected.length ? state.affected.shift() : 1 }];
        } }) }),
        insert: (table: any) => ({ values: async (values: any) => { writes.push({ op: "insert", table, values }); } }),
        delete: (table: any) => ({ where: async () => { writes.push({ op: "delete", table }); } }),
        transaction: async (cb: any) => cb(fakeTx),
    };
    return { writes, state, fakeTx };
});

vi.mock("../models/connection", () => ({ db: h.fakeTx }));
vi.mock("../utils/notifications", () => ({ sendPushNotification: vi.fn(async () => undefined) }));

import {
    claimWeightedConfirmationInTx,
    expireWeightRequestInTx,
    revertWeightRequestInTx,
} from "../helpers/weightPayment.helper";
import {
    CHECKOUT_RETRY_MIN_AGE_MINUTES,
    DEFAULT_WEIGHT_CUSTOMER_TIMEOUT_MIN,
    decideCheckoutRetry,
    decideWeightedPaymentFailure,
    decideWeightedPaymentSuccess,
    evaluateWeightedCheckout,
    FROZEN_CART_STATUSES,
    assertCartWriteAllowed,
    WeightPaymentInProgressError,
} from "../helpers/weightCart.helper";
import { cartItems, orders, paymentTransactions, weightRequests } from "../models/schema";

const NOW = new Date("2026-11-15T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60000);
const pending = { paymentStatus: "pending_payment", status: "pending" };

beforeEach(() => {
    h.writes.length = 0;
    h.state.queue = [];
    h.state.affected = [];
});

describe("re-checkout while checking_out (CHECKOUT_RETRY_MIN_AGE_MINUTES)", () => {
    it("double click: a second checkout seconds later is 'in progress', never fails the first order", () => {
        expect(decideCheckoutRetry({ checkoutStartedAt: minutesAgo(0.05), order: null, now: NOW })).toBe("in_progress");
        expect(decideCheckoutRetry({ checkoutStartedAt: minutesAgo(0.1), order: { ...pending, createdAt: minutesAgo(0.05) }, now: NOW }))
            .toBe("in_progress");
    });

    it("just below the threshold: still in progress", () => {
        const age = CHECKOUT_RETRY_MIN_AGE_MINUTES - 0.01;
        expect(decideCheckoutRetry({ checkoutStartedAt: minutesAgo(age), order: { ...pending, createdAt: minutesAgo(age) }, now: NOW }))
            .toBe("in_progress");
    });

    it("at / above the threshold: the old unpaid order is failed and the request reverted", () => {
        const age = CHECKOUT_RETRY_MIN_AGE_MINUTES;
        expect(decideCheckoutRetry({ checkoutStartedAt: minutesAgo(age), order: { ...pending, createdAt: minutesAgo(age) }, now: NOW }))
            .toBe("fail_old_order");
        expect(decideCheckoutRetry({ checkoutStartedAt: minutesAgo(10), order: null, now: NOW })).toBe("revert_claim");
    });

    it("paid / failed old orders", () => {
        expect(decideCheckoutRetry({ checkoutStartedAt: minutesAgo(10), order: { paymentStatus: "paid", status: "accepted", createdAt: minutesAgo(10) }, now: NOW }))
            .toBe("already_paid");
        expect(decideCheckoutRetry({ checkoutStartedAt: minutesAgo(10), order: { paymentStatus: "payment_failed", status: "failed", createdAt: minutesAgo(10) }, now: NOW }))
            .toBe("revert_after_failed_order");
    });

    it("checkout gate: a checking_out request gives 'payment in progress'; every cart write is frozen", () => {
        const rows = [{ id: "w1", weight: "0.5", weightRequestId: "r1", addedBy: "customer", isUnavailable: false, foodSoldBy: "weight" }];
        expect(() => evaluateWeightedCheckout(rows, { id: "r1", status: "checking_out", expiresAt: minutesAgo(-10) }, NOW))
            .toThrow(WeightPaymentInProgressError);
        expect(FROZEN_CART_STATUSES).toEqual(["checking_out"]);
        expect(() => assertCartWriteAllowed({ kind: "add", activeRequest: { id: "r1", status: "checking_out", expiresAt: NOW }, targetIsWeightBound: false }))
            .toThrow(/payment/i);
    });
});

describe("payment decisions (weighted)", () => {
    const req = (over: any = {}) => ({ orderId: "o1", status: "checking_out", paymentAttempts: 0, ...over });

    it("success", () => {
        expect(decideWeightedPaymentSuccess({ order: { id: "o1", ...pending }, request: req() })).toBe("confirm");
        expect(decideWeightedPaymentSuccess({ order: { id: "o1", paymentStatus: "paid", status: "accepted" }, request: req() })).toBe("already_paid");
        // late payments
        expect(decideWeightedPaymentSuccess({ order: { id: "o1", ...pending }, request: req({ status: "awaiting_customer_approval" }) })).toBe("needs_review");
        expect(decideWeightedPaymentSuccess({ order: { id: "o1", ...pending }, request: req({ status: "expired" }) })).toBe("needs_review");
        expect(decideWeightedPaymentSuccess({ order: { id: "o1", ...pending }, request: req({ orderId: "o2" }) })).toBe("needs_review");
        expect(decideWeightedPaymentSuccess({ order: { id: "o1", ...pending }, request: null })).toBe("needs_review");
        expect(decideWeightedPaymentSuccess({ order: { id: "o1", paymentStatus: "payment_failed", status: "failed" }, request: req() })).toBe("needs_review");
    });

    it("failure: never overwrite a paid order; revert; expire on the 3rd failure", () => {
        expect(decideWeightedPaymentFailure({ order: { id: "o1", paymentStatus: "paid", status: "accepted" }, request: req() })).toBe("ignore");
        expect(decideWeightedPaymentFailure({ order: { id: "o1", paymentStatus: "pending_payment", status: "accepted" }, request: req() })).toBe("ignore");
        expect(decideWeightedPaymentFailure({ order: { id: "o1", ...pending }, request: req() })).toBe("revert");
        expect(decideWeightedPaymentFailure({ order: { id: "o1", ...pending }, request: req({ paymentAttempts: 1 }) })).toBe("revert");
        expect(decideWeightedPaymentFailure({ order: { id: "o1", ...pending }, request: req({ paymentAttempts: 2 }) })).toBe("expire");
        expect(decideWeightedPaymentFailure({ order: { id: "o1", ...pending }, request: req({ orderId: "o2" }) })).toBe("fail_order_only");
    });
});

describe("weighted hooks / transitions against a fake transaction", () => {
    it("expireWeightRequestInTx cleans the cart ONLY when its conditional update changed the request", async () => {
        h.state.affected = [0];
        await expect(expireWeightRequestInTx(h.fakeTx, "wr-1", "x", NOW)).resolves.toBe(false);
        expect(h.writes.map((w) => w.table)).toEqual([weightRequests]);

        h.writes.length = 0;
        h.state.affected = [1];
        await expect(expireWeightRequestInTx(h.fakeTx, "wr-1", "x", NOW)).resolves.toBe(true);
        expect(h.writes.map((w) => [w.op, w.table])).toEqual([
            ["update", weightRequests], ["delete", cartItems], ["update", cartItems],
        ]);
    });

    it("revertWeightRequestInTx falls back to the column default (40 min) when settings are missing", async () => {
        h.state.queue = [[]];
        await revertWeightRequestInTx(h.fakeTx, { id: "wr-1", restaurantId: "r-1" }, { incrementAttempts: true, now: NOW });
        expect(DEFAULT_WEIGHT_CUSTOMER_TIMEOUT_MIN).toBe(40);
        expect(h.writes[0].values.status).toBe("awaiting_customer_approval");
        expect((h.writes[0].values.expiresAt as Date).getTime() - NOW.getTime()).toBe(40 * 60000);
    });

    it("claimWeightedConfirmationInTx: conditional claim wins once; a lost claim is 'already_paid'", async () => {
        const order = { id: "o1", ...pending };
        h.state.queue = [[{ id: "wr-1", orderId: "o1", status: "checking_out" }], [order]];
        h.state.affected = [1];
        await expect(claimWeightedConfirmationInTx(h.fakeTx, "o1", { gateway: "kashier" }, NOW)).resolves.toBe("confirm");
        expect(h.writes[0]).toMatchObject({ op: "update", table: orders, values: { paymentStatus: "paid" } });

        h.writes.length = 0;
        h.state.queue = [[{ id: "wr-1", orderId: "o1", status: "checking_out" }], [order]];
        h.state.affected = [0]; // someone else flipped pending_payment → paid first
        await expect(claimWeightedConfirmationInTx(h.fakeTx, "o1", { gateway: "kashier" }, NOW)).resolves.toBe("already_paid");
    });

    it("claimWeightedConfirmationInTx: request moved on → needs_review recorded once (idempotent)", async () => {
        const order = { id: "o1", orderNumber: "A", userId: "u", restaurantId: "r", totalAmount: "190.00", ...pending };
        h.state.queue = [[{ id: "wr-1", orderId: "o1", status: "expired" }], [order], []];
        await expect(claimWeightedConfirmationInTx(h.fakeTx, "o1", { gateway: "paymob", transactionId: "t1" }, NOW)).resolves.toBe("needs_review");
        expect(h.writes).toHaveLength(1);
        expect(h.writes[0]).toMatchObject({ op: "insert", table: paymentTransactions, values: { status: "needs_review", transactionId: "t1", amount: "190.00", gateway: "paymob" } });

        h.writes.length = 0;
        h.state.queue = [[{ id: "wr-1", orderId: "o1", status: "expired" }], [order], [{ id: "existing" }]];
        await claimWeightedConfirmationInTx(h.fakeTx, "o1", { gateway: "paymob", transactionId: "t1" }, NOW);
        expect(h.writes).toHaveLength(0); // gateway retry: no duplicate row
    });
});
