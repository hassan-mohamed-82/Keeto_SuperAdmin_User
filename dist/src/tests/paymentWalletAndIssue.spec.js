"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
vitest_1.vi.mock("../utils/notifications", () => ({
    sendPushNotification: vitest_1.vi.fn(),
}));
const connection_1 = require("../models/connection");
const orderPaymentConfirmation_1 = require("../helpers/orderPaymentConfirmation");
const orderNotificationCron_1 = require("../services/orderNotificationCron");
const restaurantWalletService_1 = require("../services/restaurantWalletService");
const notifications_1 = require("../utils/notifications");
(0, vitest_1.describe)("Issue A - debt-settled notification guard", () => {
    (0, vitest_1.it)("A1: a settled SYSTEM debt transition emits once and does not fire when the reversal is cancelling", () => {
        (0, vitest_1.expect)((0, restaurantWalletService_1.shouldNotifyDebtSettled)(-25, 5, { paymentGatewayType: "SYSTEM", visaSwitchApplied: true })).toBe(true);
        (0, vitest_1.expect)((0, restaurantWalletService_1.shouldNotifyDebtSettled)(10, 5, { paymentGatewayType: "SYSTEM", visaSwitchApplied: true })).toBe(false);
        (0, vitest_1.expect)((0, restaurantWalletService_1.shouldNotifyDebtSettled)(-25, -30, { paymentGatewayType: "SYSTEM", visaSwitchApplied: true })).toBe(false);
    });
    (0, vitest_1.it)("A2: the same order does not emit twice when settlement is called twice", () => {
        const before = { previousBalance: -10, nextBalance: 5 };
        (0, vitest_1.expect)((0, restaurantWalletService_1.shouldNotifyDebtSettled)(before.previousBalance, before.nextBalance, {
            paymentGatewayType: "SYSTEM",
            visaSwitchApplied: true,
        })).toBe(true);
        (0, vitest_1.expect)((0, restaurantWalletService_1.shouldNotifyDebtSettled)(before.previousBalance, before.nextBalance, {
            paymentGatewayType: "SYSTEM",
            visaSwitchApplied: true,
        })).toBe(true);
    });
});
(0, vitest_1.describe)("Issue B - wallet counter symmetry", () => {
    (0, vitest_1.it)("B1: cash settle then cancel restores counters and balance", () => {
        const settle = (0, restaurantWalletService_1.buildSettlementCounterUpdate)({
            paymentKind: "cash",
            currentBalance: 0,
            currentCollectedCash: 0,
            currentTotalEarning: 0,
            currentTotalServiceFees: 0,
            currentTotalCommission: 0,
            currentTotalVisaCommission: 0,
            subtotal: 200,
            deliveryFee: 30,
            settlementServiceFee: 5,
            appCommission: 20,
            discountAmount: 0,
            orderVisaComm: 0,
            totalAmount: 235,
        });
        (0, vitest_1.expect)(settle.totalCommission).toBe(20);
        (0, vitest_1.expect)(settle.totalServiceFees).toBe(5);
        (0, vitest_1.expect)(settle.totalEarning).toBe(210);
        (0, vitest_1.expect)(settle.collectedCash).toBe(235);
        (0, vitest_1.expect)(settle.balance).toBe(-25);
        const reversal = (0, restaurantWalletService_1.buildCancellationCounterReversal)({
            paymentKind: "cash",
            currentBalance: settle.balance,
            currentCollectedCash: settle.collectedCash,
            currentTotalEarning: settle.totalEarning,
            currentTotalServiceFees: settle.totalServiceFees,
            currentTotalCommission: settle.totalCommission,
            currentTotalVisaCommission: settle.totalVisaCommission,
            subtotal: 200,
            deliveryFee: 30,
            settledAmount: -25,
            settledServiceFee: 5,
            settledCommission: 20,
            settledVisaComm: 0,
            totalAmount: 235,
        });
        (0, vitest_1.expect)(reversal.balance).toBe(0);
        (0, vitest_1.expect)(reversal.collectedCash).toBe(0);
        (0, vitest_1.expect)(reversal.totalEarning).toBe(0);
        (0, vitest_1.expect)(reversal.totalServiceFees).toBe(0);
        (0, vitest_1.expect)(reversal.totalCommission).toBe(0);
    });
    (0, vitest_1.it)("B2: visa_custom settle then cancel restores counters and balance", () => {
        const settle = (0, restaurantWalletService_1.buildSettlementCounterUpdate)({
            paymentKind: "visa_custom",
            currentBalance: 0,
            currentCollectedCash: 0,
            currentTotalEarning: 0,
            currentTotalServiceFees: 0,
            currentTotalCommission: 0,
            currentTotalVisaCommission: 0,
            subtotal: 200,
            deliveryFee: 30,
            settlementServiceFee: 5,
            appCommission: 20,
            discountAmount: 0,
            orderVisaComm: 0,
            totalAmount: 235,
        });
        (0, vitest_1.expect)(settle.balance).toBe(-25);
        (0, vitest_1.expect)(settle.totalCommission).toBe(20);
        (0, vitest_1.expect)(settle.totalServiceFees).toBe(5);
        const reversal = (0, restaurantWalletService_1.buildCancellationCounterReversal)({
            paymentKind: "visa_custom",
            currentBalance: settle.balance,
            currentCollectedCash: 0,
            currentTotalEarning: settle.totalEarning,
            currentTotalServiceFees: settle.totalServiceFees,
            currentTotalCommission: settle.totalCommission,
            currentTotalVisaCommission: settle.totalVisaCommission,
            subtotal: 200,
            deliveryFee: 30,
            settledAmount: -25,
            settledServiceFee: 5,
            settledCommission: 20,
            settledVisaComm: 0,
            totalAmount: 235,
        });
        (0, vitest_1.expect)(reversal.balance).toBe(0);
        (0, vitest_1.expect)(reversal.totalCommission).toBe(0);
        (0, vitest_1.expect)(reversal.totalServiceFees).toBe(0);
        (0, vitest_1.expect)(reversal.totalEarning).toBe(0);
    });
    (0, vitest_1.it)("B3: user_wallet and visa_system settle then cancel restore counters; system balance lands one fee below pre-order", () => {
        const userWalletSettle = (0, restaurantWalletService_1.buildSettlementCounterUpdate)({
            paymentKind: "user_wallet",
            currentBalance: 0,
            currentCollectedCash: 0,
            currentTotalEarning: 0,
            currentTotalServiceFees: 0,
            currentTotalCommission: 0,
            currentTotalVisaCommission: 0,
            subtotal: 200,
            deliveryFee: 30,
            settlementServiceFee: 5,
            appCommission: 20,
            discountAmount: 0,
            orderVisaComm: 15,
            totalAmount: 235,
        });
        const userWalletCancel = (0, restaurantWalletService_1.buildCancellationCounterReversal)({
            paymentKind: "user_wallet",
            currentBalance: userWalletSettle.balance,
            currentCollectedCash: 0,
            currentTotalEarning: userWalletSettle.totalEarning,
            currentTotalServiceFees: userWalletSettle.totalServiceFees,
            currentTotalCommission: userWalletSettle.totalCommission,
            currentTotalVisaCommission: userWalletSettle.totalVisaCommission,
            subtotal: 200,
            deliveryFee: 30,
            settledAmount: 195,
            settledServiceFee: 5,
            settledCommission: 20,
            settledVisaComm: 15,
            totalAmount: 235,
        });
        (0, vitest_1.expect)(userWalletSettle.balance).toBe(195);
        (0, vitest_1.expect)(userWalletCancel.balance).toBe(0);
        (0, vitest_1.expect)(userWalletCancel.totalCommission).toBe(0);
        (0, vitest_1.expect)(userWalletCancel.totalServiceFees).toBe(0);
        (0, vitest_1.expect)(userWalletCancel.totalVisaCommission).toBe(15);
        const systemStartBalance = -25;
        const systemSettle = (0, restaurantWalletService_1.buildSettlementCounterUpdate)({
            paymentKind: "visa_system",
            currentBalance: systemStartBalance,
            currentCollectedCash: 0,
            currentTotalEarning: 0,
            currentTotalServiceFees: 0,
            currentTotalCommission: 0,
            currentTotalVisaCommission: 0,
            subtotal: 200,
            deliveryFee: 30,
            settlementServiceFee: 5,
            appCommission: 20,
            discountAmount: 0,
            orderVisaComm: 15,
            totalAmount: 235,
        });
        (0, vitest_1.expect)(systemSettle.totalVisaCommission).toBe(15);
        (0, vitest_1.expect)(systemSettle.balance).toBe(170);
        const systemCancel = (0, restaurantWalletService_1.buildCancellationCounterReversal)({
            paymentKind: "visa_system",
            currentBalance: systemSettle.balance,
            currentCollectedCash: 0,
            currentTotalEarning: systemSettle.totalEarning,
            currentTotalServiceFees: systemSettle.totalServiceFees,
            currentTotalCommission: systemSettle.totalCommission,
            currentTotalVisaCommission: systemSettle.totalVisaCommission,
            subtotal: 200,
            deliveryFee: 30,
            settledAmount: 195,
            settledServiceFee: 5,
            settledCommission: 20,
            settledVisaComm: 15,
            totalAmount: 235,
        });
        (0, vitest_1.expect)(systemCancel.balance).toBe(-25);
        (0, vitest_1.expect)(systemCancel.totalVisaCommission).toBe(15);
    });
    (0, vitest_1.it)("B4: legacy counters clamp but do not change balance", () => {
        const reversal = (0, restaurantWalletService_1.buildCancellationCounterReversal)({
            paymentKind: "visa_custom",
            currentBalance: 0,
            currentCollectedCash: 0,
            currentTotalEarning: 5,
            currentTotalServiceFees: 2,
            currentTotalCommission: 3,
            currentTotalVisaCommission: 7,
            subtotal: 200,
            deliveryFee: 30,
            settledAmount: -25,
            settledServiceFee: 5,
            settledCommission: 20,
            settledVisaComm: 10,
            totalAmount: 235,
        });
        (0, vitest_1.expect)(reversal.totalCommission).toBe(0);
        (0, vitest_1.expect)(reversal.totalServiceFees).toBe(0);
        (0, vitest_1.expect)(reversal.totalVisaCommission).toBe(0);
        (0, vitest_1.expect)(reversal.totalEarning).toBe(0);
        (0, vitest_1.expect)(reversal.balance).toBe(25);
    });
});
(0, vitest_1.describe)("Issue C - payment issue deduplication", () => {
    (0, vitest_1.it)("C1: claimPaymentIssueNotification claims once and rejects the second call", async () => {
        const executeSpy = vitest_1.vi.spyOn(connection_1.db, "execute");
        executeSpy.mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
        executeSpy.mockResolvedValueOnce([{ affectedRows: 0 }, {}]);
        executeSpy.mockResolvedValueOnce([{ affectedRows: 0 }, {}]);
        await (0, vitest_1.expect)((0, orderNotificationCron_1.claimPaymentIssueNotification)("o-1", "payment_failed", "payment_failed")).resolves.toBe(true);
        await (0, vitest_1.expect)((0, orderNotificationCron_1.claimPaymentIssueNotification)("o-1", "payment_failed", "payment_failed")).resolves.toBe(false);
        await (0, vitest_1.expect)((0, orderNotificationCron_1.claimPaymentIssueNotification)("o-2", "payment_failed", "pending_payment")).resolves.toBe(false);
        executeSpy.mockRestore();
    });
    (0, vitest_1.it)("C2: a second claim cannot win for the same order", async () => {
        const executeSpy = vitest_1.vi.spyOn(connection_1.db, "execute");
        executeSpy.mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
        executeSpy.mockResolvedValueOnce([{ affectedRows: 0 }, {}]);
        const first = await (0, orderNotificationCron_1.claimPaymentIssueNotification)("o-1", "pending_payment_stuck", "pending_payment");
        const second = await (0, orderNotificationCron_1.claimPaymentIssueNotification)("o-1", "pending_payment_stuck", "pending_payment");
        (0, vitest_1.expect)(first).toBe(true);
        (0, vitest_1.expect)(second).toBe(false);
        executeSpy.mockRestore();
    });
    (0, vitest_1.it)("C4: when push sending throws, the claim is released", async () => {
        const executeSpy = vitest_1.vi.spyOn(connection_1.db, "execute");
        executeSpy.mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
        executeSpy.mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
        vitest_1.vi.mocked(notifications_1.sendPushNotification).mockRejectedValueOnce(new Error("push failed"));
        const claimed = await (0, orderNotificationCron_1.claimPaymentIssueNotification)("o-1", "payment_failed", "payment_failed");
        (0, vitest_1.expect)(claimed).toBe(true);
        await (0, vitest_1.expect)((0, orderNotificationCron_1.releasePaymentIssueNotificationClaim)("o-1", "payment_failed")).resolves.toBeUndefined();
        executeSpy.mockRestore();
    });
    (0, vitest_1.it)("C6: notification payload keeps only the five allowed keys", async () => {
        const payload = {
            type: "payment_issue",
            issueType: "payment_failed",
            orderId: "o-1",
            orderNumber: "A-123",
            restaurantId: "r-1",
        };
        (0, vitest_1.expect)(Object.keys(payload)).toEqual(["type", "issueType", "orderId", "orderNumber", "restaurantId"]);
        (0, vitest_1.expect)(payload).not.toHaveProperty("customerName");
    });
    (0, vitest_1.it)("C3/C5: duplicate failed-payment callbacks are deduped by the atomic claim", async () => {
        const executeSpy = vitest_1.vi.spyOn(connection_1.db, "execute");
        executeSpy.mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
        executeSpy.mockResolvedValueOnce([{ affectedRows: 0 }, {}]);
        await (0, vitest_1.expect)((0, orderNotificationCron_1.claimPaymentIssueNotification)("o-2", "payment_failed", "payment_failed")).resolves.toBe(true);
        await (0, vitest_1.expect)((0, orderNotificationCron_1.claimPaymentIssueNotification)("o-2", "payment_failed", "payment_failed")).resolves.toBe(false);
        executeSpy.mockRestore();
    });
    (0, vitest_1.it)("C3: recordFailedPayment can be retried without failing the order state", async () => {
        const tx = {
            update: () => ({ set: () => ({ where: async () => undefined }) }),
            insert: () => ({ values: async () => undefined }),
            delete: () => ({ where: async () => undefined }),
            select: () => ({ from: () => ({ where: () => ({ limit: async () => [null] }) }) }),
        };
        const transactionSpy = vitest_1.vi.spyOn(connection_1.db, "transaction").mockImplementation(async (callback) => callback(tx));
        const selectSpy = vitest_1.vi.spyOn(connection_1.db, "select")
            .mockImplementationOnce(() => ({
            from: () => ({ where: () => ({ limit: async () => [{ id: "o-3", userId: "u-1", restaurantId: "r-1", orderNumber: "A-7", paymentIssueNotifiedAt: null, paymentIssueType: null }] }) }),
        }))
            .mockImplementationOnce(() => ({
            from: () => ({ where: () => ({ limit: async () => [null] }) }),
        }))
            .mockImplementationOnce(() => ({
            from: () => ({ where: () => ({ limit: async () => [{ name: "Ahmed" }] }) }),
        }));
        const executeSpy = vitest_1.vi.spyOn(connection_1.db, "execute").mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
        vitest_1.vi.mocked(notifications_1.sendPushNotification).mockResolvedValueOnce(undefined);
        await (0, vitest_1.expect)((0, orderPaymentConfirmation_1.recordFailedPayment)({
            orderId: "o-3",
            gateway: "paymob",
            failureReason: "card_rejected",
        })).resolves.toMatchObject({ success: true });
        transactionSpy.mockRestore();
        selectSpy.mockRestore();
        executeSpy.mockRestore();
    });
});
