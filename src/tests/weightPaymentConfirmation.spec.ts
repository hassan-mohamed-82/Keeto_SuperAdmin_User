// confirmOrderPayment / recordFailedPayment with the weighted hooks:
// 1. a NORMAL order produces exactly the same writes, return values and notifications as before,
//    and none of the weighted hooks runs;
// 2. for a WEIGHTED order the hooks short-circuit correctly (late payment, already confirmed, paid order).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
    const writes: Array<{ op: string; table: any; values?: any }> = [];
    const state = { queue: [] as any[][] };
    const chain = (result: any) => {
        const c: any = {};
        for (const m of ["from", "where", "limit", "for", "leftJoin", "innerJoin", "orderBy"]) c[m] = () => c;
        c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
        return c;
    };
    const fakeDb: any = {
        select: () => chain(state.queue.shift() ?? []),
        update: (table: any) => ({ set: (values: any) => ({ where: async () => { writes.push({ op: "update", table, values }); return [{ affectedRows: 1 }]; } }) }),
        insert: (table: any) => ({ values: async (values: any) => { writes.push({ op: "insert", table, values }); } }),
        delete: (table: any) => ({ where: async () => { writes.push({ op: "delete", table }); } }),
        transaction: async (cb: any) => cb(fakeDb),
    };
    return { writes, state, fakeDb };
});
const writes = h.writes;
const setQueue = (q: any[][]) => { h.state.queue = q; };

vi.mock("../models/connection", () => ({ db: h.fakeDb }));
vi.mock("../utils/notifications", () => ({ sendPushNotification: vi.fn(async () => undefined) }));
vi.mock("../services/restaurantWalletService", () => ({
    settleDeliveredOrder: vi.fn(async () => undefined),
    chargePendingServiceFee: vi.fn(async () => undefined),
}));
vi.mock("../services/orderNotificationCron", () => ({
    claimPaymentIssueNotification: vi.fn(async () => true),
    releasePaymentIssueNotificationClaim: vi.fn(async () => undefined),
}));
vi.mock("../helpers/getNextDailyOrderNumber", () => ({ getNextDailyOrderNumber: vi.fn(async () => 7) }));
vi.mock("../helpers/firstOrderDiscount.helper", () => ({ recordFirstOrderDiscountUsage: vi.fn(async () => undefined) }));
vi.mock("../utils/calculateVisaCommission", () => ({ calculateVisaCommission: vi.fn(() => 3.5) }));
vi.mock("../utils/getActiveCustomGateway", () => ({ getActiveCustomGateway: vi.fn(async () => null) }));
vi.mock("../utils/getSystemVisaSettings", () => ({
    getSystemVisaSettings: vi.fn(async () => ({ percentageValue: 2, fixedValue: 1, tax: 0 })),
}));
vi.mock("../helpers/weightPayment.helper", () => ({
    isWeightedOrder: vi.fn(async () => false),
    handleLateWeightedPayment: vi.fn(async () => false),
    claimWeightedConfirmationInTx: vi.fn(async () => "confirm"),
    approveWeightRequestInTx: vi.fn(async () => undefined),
    weightedFailureGateInTx: vi.fn(async () => ({ outcome: "revert", request: null, order: null })),
    applyWeightedFailureToRequestInTx: vi.fn(async () => null),
    notifyWeightRequestExpiredAfterPayments: vi.fn(async () => undefined),
}));

import { confirmOrderPayment, recordFailedPayment } from "../helpers/orderPaymentConfirmation";
import * as weighted from "../helpers/weightPayment.helper";
import { sendPushNotification } from "../utils/notifications";
import { settleDeliveredOrder } from "../services/restaurantWalletService";
import { cartItems, orders, paymentTransactions } from "../models/schema";

const order = {
    id: "o-1", orderNumber: "ORD-1", userId: "u-1", restaurantId: "r-1", branchId: null,
    paymentStatus: "pending_payment", status: "pending", dailyOrderNumber: null,
    visaCommission: "0", paymentGatewayType: "SYSTEM", totalAmount: "190.00",
    paymentTransactionId: null, paymentOrderId: "sess-1", paymentMethod: "pm-visa",
    firstOrderDiscountId: null, discountAmount: "0",
};

const hooksCalled = () =>
    [weighted.handleLateWeightedPayment, weighted.claimWeightedConfirmationInTx, weighted.approveWeightRequestInTx,
        weighted.weightedFailureGateInTx, weighted.applyWeightedFailureToRequestInTx, weighted.notifyWeightRequestExpiredAfterPayments]
        .some((fn) => vi.mocked(fn).mock.calls.length > 0);

beforeEach(() => {
    writes.length = 0;
    setQueue([]);
    vi.clearAllMocks();
    vi.mocked(weighted.isWeightedOrder).mockResolvedValue(false);
});

describe("normal (non-weighted) orders are unchanged", () => {
    it("confirmOrderPayment: same writes, return value and notification; no weighted hook", async () => {
        setQueue([[order], [{ id: "pm-digital" }], [{ restaurantId: "r-1" }]]);
        const res = await confirmOrderPayment({ orderId: "o-1", gateway: "kashier", transactionId: "tx-1", gatewayOrderId: "g-1" });

        expect(res).toEqual({ success: true, dailyOrderNumber: 7 });
        expect(writes.map((w) => [w.op, w.table])).toEqual([
            ["update", orders],
            ["insert", paymentTransactions],
            ["delete", cartItems],
        ]);
        expect(writes[0].values).toMatchObject({
            paymentStatus: "paid", status: "accepted", paymentGateway: "kashier", paymentTransactionId: "tx-1",
            paymentOrderId: "g-1", dailyOrderNumber: 7, paymentMethod: "pm-digital", visaCommission: "3.50", paymentFailureReason: null,
        });
        expect(writes[1].values).toMatchObject({ status: "success", gateway: "kashier", transactionId: "tx-1", amount: "190.00" });
        expect(settleDeliveredOrder).toHaveBeenCalledTimes(1);
        expect(sendPushNotification).toHaveBeenCalledTimes(1);
        expect(vi.mocked(sendPushNotification).mock.calls[0][0]).toMatchObject({ recipientType: "restaurant", recipientId: "r-1" });
        expect(hooksCalled()).toBe(false);
    });

    it("confirmOrderPayment: already paid returns the same result as before", async () => {
        setQueue([[{ ...order, paymentStatus: "paid" }]]);
        await expect(confirmOrderPayment({ orderId: "o-1", gateway: "kashier" })).resolves.toEqual({ success: true, alreadyProcessed: true });
        expect(writes).toEqual([]);
        expect(weighted.isWeightedOrder).not.toHaveBeenCalled();
    });

    it("recordFailedPayment: same writes, return value and notification; no weighted hook", async () => {
        setQueue([[order], [], [{ name: "Ahmed" }]]); // order, coupon usage (none), customer name
        const res = await recordFailedPayment({ orderId: "o-1", gateway: "paymob", transactionId: "tx-2", failureReason: "declined" });

        expect(res).toEqual({ success: true });
        expect(writes.map((w) => [w.op, w.table])).toEqual([
            ["update", orders],
            ["insert", paymentTransactions],
        ]);
        expect(writes[0].values).toMatchObject({ status: "failed", paymentStatus: "payment_failed", paymentFailureReason: "declined" });
        expect(writes[1].values).toMatchObject({ status: "failed", gateway: "paymob", transactionId: "tx-2" });
        expect(sendPushNotification).toHaveBeenCalledTimes(1);
        expect(hooksCalled()).toBe(false);
    });
});

describe("weighted orders: hooks", () => {
    beforeEach(() => vi.mocked(weighted.isWeightedOrder).mockResolvedValue(true));

    it("late payment is handled before the transaction: needs_review, no confirmation writes", async () => {
        vi.mocked(weighted.handleLateWeightedPayment).mockResolvedValueOnce(true);
        setQueue([[order]]);
        await expect(confirmOrderPayment({ orderId: "o-1", gateway: "kashier", transactionId: "tx-9" }))
            .resolves.toEqual({ success: true, needsReview: true });
        expect(writes).toEqual([]);
        expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it("claim lost (another webhook / redirect confirmed first): already processed, nothing else written", async () => {
        vi.mocked(weighted.claimWeightedConfirmationInTx).mockResolvedValueOnce("already_paid");
        setQueue([[order], [{ id: "pm-digital" }], [{ restaurantId: "r-1" }]]);
        await expect(confirmOrderPayment({ orderId: "o-1", gateway: "paymob" }))
            .resolves.toEqual({ success: true, alreadyProcessed: true });
        expect(writes).toEqual([]);
        expect(settleDeliveredOrder).not.toHaveBeenCalled();
        expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it("claim won: the single success body runs, then the request is approved in the same transaction", async () => {
        setQueue([[order], [{ id: "pm-digital" }], [{ restaurantId: "r-1" }]]);
        await expect(confirmOrderPayment({ orderId: "o-1", gateway: "kashier" })).resolves.toEqual({ success: true, dailyOrderNumber: 7 });
        expect(writes.map((w) => w.table)).toEqual([orders, paymentTransactions, cartItems]);
        expect(weighted.approveWeightRequestInTx).toHaveBeenCalledTimes(1);
    });

    it("failure on an already paid weighted order: nothing written, no restaurant notification", async () => {
        vi.mocked(weighted.weightedFailureGateInTx).mockResolvedValueOnce({ outcome: "ignore", request: null, order: null });
        setQueue([[{ ...order, paymentStatus: "paid", status: "accepted" }]]);
        await expect(recordFailedPayment({ orderId: "o-1", gateway: "kashier", failureReason: "late fail" }))
            .resolves.toEqual({ success: true });
        expect(writes).toEqual([]);
        expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it("failure at the attempt limit: request expired in the tx, customer notified after commit", async () => {
        vi.mocked(weighted.applyWeightedFailureToRequestInTx).mockResolvedValueOnce({ userId: "u-1", requestId: "wr-1" });
        setQueue([[order], [], [{ name: "Ahmed" }]]);
        await recordFailedPayment({ orderId: "o-1", gateway: "kashier", failureReason: "declined" });
        expect(writes.map((w) => w.table)).toEqual([orders, paymentTransactions]);
        expect(weighted.notifyWeightRequestExpiredAfterPayments).toHaveBeenCalledWith("u-1", "wr-1");
    });
});
