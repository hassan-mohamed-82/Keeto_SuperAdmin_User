"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// confirmOrderPayment / recordFailedPayment with the weighted hooks:
// 1. a NORMAL order produces exactly the same writes, return values and notifications as before,
//    and none of the weighted hooks runs;
// 2. for a WEIGHTED order the hooks short-circuit correctly (late payment, already confirmed, paid order).
const vitest_1 = require("vitest");
const h = vitest_1.vi.hoisted(() => {
    const writes = [];
    const state = { queue: [] };
    const chain = (result) => {
        const c = {};
        for (const m of ["from", "where", "limit", "for", "leftJoin", "innerJoin", "orderBy"])
            c[m] = () => c;
        c.then = (res, rej) => Promise.resolve(result).then(res, rej);
        return c;
    };
    const fakeDb = {
        select: () => chain(state.queue.shift() ?? []),
        update: (table) => ({ set: (values) => ({ where: async () => { writes.push({ op: "update", table, values }); return [{ affectedRows: 1 }]; } }) }),
        insert: (table) => ({ values: async (values) => { writes.push({ op: "insert", table, values }); } }),
        delete: (table) => ({ where: async () => { writes.push({ op: "delete", table }); } }),
        transaction: async (cb) => cb(fakeDb),
    };
    return { writes, state, fakeDb };
});
const writes = h.writes;
const setQueue = (q) => { h.state.queue = q; };
vitest_1.vi.mock("../models/connection", () => ({ db: h.fakeDb }));
vitest_1.vi.mock("../utils/notifications", () => ({ sendPushNotification: vitest_1.vi.fn(async () => undefined) }));
vitest_1.vi.mock("../services/restaurantWalletService", () => ({
    settleDeliveredOrder: vitest_1.vi.fn(async () => undefined),
    chargePendingServiceFee: vitest_1.vi.fn(async () => undefined),
}));
vitest_1.vi.mock("../services/orderNotificationCron", () => ({
    claimPaymentIssueNotification: vitest_1.vi.fn(async () => true),
    releasePaymentIssueNotificationClaim: vitest_1.vi.fn(async () => undefined),
}));
vitest_1.vi.mock("../helpers/getNextDailyOrderNumber", () => ({ getNextDailyOrderNumber: vitest_1.vi.fn(async () => 7) }));
vitest_1.vi.mock("../helpers/firstOrderDiscount.helper", () => ({ recordFirstOrderDiscountUsage: vitest_1.vi.fn(async () => undefined) }));
vitest_1.vi.mock("../utils/calculateVisaCommission", () => ({ calculateVisaCommission: vitest_1.vi.fn(() => 3.5) }));
vitest_1.vi.mock("../utils/getActiveCustomGateway", () => ({ getActiveCustomGateway: vitest_1.vi.fn(async () => null) }));
vitest_1.vi.mock("../utils/getSystemVisaSettings", () => ({
    getSystemVisaSettings: vitest_1.vi.fn(async () => ({ percentageValue: 2, fixedValue: 1, tax: 0 })),
}));
vitest_1.vi.mock("../helpers/weightPayment.helper", () => ({
    isWeightedOrder: vitest_1.vi.fn(async () => false),
    handleLateWeightedPayment: vitest_1.vi.fn(async () => false),
    claimWeightedConfirmationInTx: vitest_1.vi.fn(async () => "confirm"),
    approveWeightRequestInTx: vitest_1.vi.fn(async () => undefined),
    weightedFailureGateInTx: vitest_1.vi.fn(async () => ({ outcome: "revert", request: null, order: null })),
    applyWeightedFailureToRequestInTx: vitest_1.vi.fn(async () => null),
    notifyWeightRequestExpiredAfterPayments: vitest_1.vi.fn(async () => undefined),
}));
const orderPaymentConfirmation_1 = require("../helpers/orderPaymentConfirmation");
const weighted = __importStar(require("../helpers/weightPayment.helper"));
const notifications_1 = require("../utils/notifications");
const restaurantWalletService_1 = require("../services/restaurantWalletService");
const schema_1 = require("../models/schema");
const order = {
    id: "o-1", orderNumber: "ORD-1", userId: "u-1", restaurantId: "r-1", branchId: null,
    paymentStatus: "pending_payment", status: "pending", dailyOrderNumber: null,
    visaCommission: "0", paymentGatewayType: "SYSTEM", totalAmount: "190.00",
    paymentTransactionId: null, paymentOrderId: "sess-1", paymentMethod: "pm-visa",
    firstOrderDiscountId: null, discountAmount: "0",
};
const hooksCalled = () => [weighted.handleLateWeightedPayment, weighted.claimWeightedConfirmationInTx, weighted.approveWeightRequestInTx,
    weighted.weightedFailureGateInTx, weighted.applyWeightedFailureToRequestInTx, weighted.notifyWeightRequestExpiredAfterPayments]
    .some((fn) => vitest_1.vi.mocked(fn).mock.calls.length > 0);
(0, vitest_1.beforeEach)(() => {
    writes.length = 0;
    setQueue([]);
    vitest_1.vi.clearAllMocks();
    vitest_1.vi.mocked(weighted.isWeightedOrder).mockResolvedValue(false);
});
(0, vitest_1.describe)("normal (non-weighted) orders are unchanged", () => {
    (0, vitest_1.it)("confirmOrderPayment: same writes, return value and notification; no weighted hook", async () => {
        setQueue([[order], [{ id: "pm-digital" }], [{ restaurantId: "r-1" }]]);
        const res = await (0, orderPaymentConfirmation_1.confirmOrderPayment)({ orderId: "o-1", gateway: "kashier", transactionId: "tx-1", gatewayOrderId: "g-1" });
        (0, vitest_1.expect)(res).toEqual({ success: true, dailyOrderNumber: 7 });
        (0, vitest_1.expect)(writes.map((w) => [w.op, w.table])).toEqual([
            ["update", schema_1.orders],
            ["insert", schema_1.paymentTransactions],
            ["delete", schema_1.cartItems],
        ]);
        (0, vitest_1.expect)(writes[0].values).toMatchObject({
            paymentStatus: "paid", status: "accepted", paymentGateway: "kashier", paymentTransactionId: "tx-1",
            paymentOrderId: "g-1", dailyOrderNumber: 7, paymentMethod: "pm-digital", visaCommission: "3.50", paymentFailureReason: null,
        });
        (0, vitest_1.expect)(writes[1].values).toMatchObject({ status: "success", gateway: "kashier", transactionId: "tx-1", amount: "190.00" });
        (0, vitest_1.expect)(restaurantWalletService_1.settleDeliveredOrder).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(notifications_1.sendPushNotification).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(vitest_1.vi.mocked(notifications_1.sendPushNotification).mock.calls[0][0]).toMatchObject({ recipientType: "restaurant", recipientId: "r-1" });
        (0, vitest_1.expect)(hooksCalled()).toBe(false);
    });
    (0, vitest_1.it)("confirmOrderPayment: already paid returns the same result as before", async () => {
        setQueue([[{ ...order, paymentStatus: "paid" }]]);
        await (0, vitest_1.expect)((0, orderPaymentConfirmation_1.confirmOrderPayment)({ orderId: "o-1", gateway: "kashier" })).resolves.toEqual({ success: true, alreadyProcessed: true });
        (0, vitest_1.expect)(writes).toEqual([]);
        (0, vitest_1.expect)(weighted.isWeightedOrder).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("recordFailedPayment: same writes, return value and notification; no weighted hook", async () => {
        setQueue([[order], [], [{ name: "Ahmed" }]]); // order, coupon usage (none), customer name
        const res = await (0, orderPaymentConfirmation_1.recordFailedPayment)({ orderId: "o-1", gateway: "paymob", transactionId: "tx-2", failureReason: "declined" });
        (0, vitest_1.expect)(res).toEqual({ success: true });
        (0, vitest_1.expect)(writes.map((w) => [w.op, w.table])).toEqual([
            ["update", schema_1.orders],
            ["insert", schema_1.paymentTransactions],
        ]);
        (0, vitest_1.expect)(writes[0].values).toMatchObject({ status: "failed", paymentStatus: "payment_failed", paymentFailureReason: "declined" });
        (0, vitest_1.expect)(writes[1].values).toMatchObject({ status: "failed", gateway: "paymob", transactionId: "tx-2" });
        (0, vitest_1.expect)(notifications_1.sendPushNotification).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(hooksCalled()).toBe(false);
    });
});
(0, vitest_1.describe)("weighted orders: hooks", () => {
    (0, vitest_1.beforeEach)(() => vitest_1.vi.mocked(weighted.isWeightedOrder).mockResolvedValue(true));
    (0, vitest_1.it)("late payment is handled before the transaction: needs_review, no confirmation writes", async () => {
        vitest_1.vi.mocked(weighted.handleLateWeightedPayment).mockResolvedValueOnce(true);
        setQueue([[order]]);
        await (0, vitest_1.expect)((0, orderPaymentConfirmation_1.confirmOrderPayment)({ orderId: "o-1", gateway: "kashier", transactionId: "tx-9" }))
            .resolves.toEqual({ success: true, needsReview: true });
        (0, vitest_1.expect)(writes).toEqual([]);
        (0, vitest_1.expect)(notifications_1.sendPushNotification).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("claim lost (another webhook / redirect confirmed first): already processed, nothing else written", async () => {
        vitest_1.vi.mocked(weighted.claimWeightedConfirmationInTx).mockResolvedValueOnce("already_paid");
        setQueue([[order], [{ id: "pm-digital" }], [{ restaurantId: "r-1" }]]);
        await (0, vitest_1.expect)((0, orderPaymentConfirmation_1.confirmOrderPayment)({ orderId: "o-1", gateway: "paymob" }))
            .resolves.toEqual({ success: true, alreadyProcessed: true });
        (0, vitest_1.expect)(writes).toEqual([]);
        (0, vitest_1.expect)(restaurantWalletService_1.settleDeliveredOrder).not.toHaveBeenCalled();
        (0, vitest_1.expect)(notifications_1.sendPushNotification).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("claim won: the single success body runs, then the request is approved in the same transaction", async () => {
        setQueue([[order], [{ id: "pm-digital" }], [{ restaurantId: "r-1" }]]);
        await (0, vitest_1.expect)((0, orderPaymentConfirmation_1.confirmOrderPayment)({ orderId: "o-1", gateway: "kashier" })).resolves.toEqual({ success: true, dailyOrderNumber: 7 });
        (0, vitest_1.expect)(writes.map((w) => w.table)).toEqual([schema_1.orders, schema_1.paymentTransactions, schema_1.cartItems]);
        (0, vitest_1.expect)(weighted.approveWeightRequestInTx).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)("failure on an already paid weighted order: nothing written, no restaurant notification", async () => {
        vitest_1.vi.mocked(weighted.weightedFailureGateInTx).mockResolvedValueOnce({ outcome: "ignore", request: null, order: null });
        setQueue([[{ ...order, paymentStatus: "paid", status: "accepted" }]]);
        await (0, vitest_1.expect)((0, orderPaymentConfirmation_1.recordFailedPayment)({ orderId: "o-1", gateway: "kashier", failureReason: "late fail" }))
            .resolves.toEqual({ success: true });
        (0, vitest_1.expect)(writes).toEqual([]);
        (0, vitest_1.expect)(notifications_1.sendPushNotification).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("failure at the attempt limit: request expired in the tx, customer notified after commit", async () => {
        vitest_1.vi.mocked(weighted.applyWeightedFailureToRequestInTx).mockResolvedValueOnce({ userId: "u-1", requestId: "wr-1" });
        setQueue([[order], [], [{ name: "Ahmed" }]]);
        await (0, orderPaymentConfirmation_1.recordFailedPayment)({ orderId: "o-1", gateway: "kashier", failureReason: "declined" });
        (0, vitest_1.expect)(writes.map((w) => w.table)).toEqual([schema_1.orders, schema_1.paymentTransactions]);
        (0, vitest_1.expect)(weighted.notifyWeightRequestExpiredAfterPayments).toHaveBeenCalledWith("u-1", "wr-1");
    });
});
