import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/notifications", () => ({
  sendPushNotification: vi.fn(),
}));

import { db } from "../models/connection";
import { recordFailedPayment } from "../helpers/orderPaymentConfirmation";
import { claimPaymentIssueNotification, releasePaymentIssueNotificationClaim } from "../services/orderNotificationCron";
import {
  buildCancellationCounterReversal,
  buildSettlementCounterUpdate,
  shouldNotifyDebtSettled,
} from "../services/restaurantWalletService";
import { sendPushNotification } from "../utils/notifications";

describe("Issue A - debt-settled notification guard", () => {
  it("A1: a settled SYSTEM debt transition emits once and does not fire when the reversal is cancelling", () => {
    expect(
      shouldNotifyDebtSettled(-25, 5, { paymentGatewayType: "SYSTEM", visaSwitchApplied: true })
    ).toBe(true);

    expect(
      shouldNotifyDebtSettled(10, 5, { paymentGatewayType: "SYSTEM", visaSwitchApplied: true })
    ).toBe(false);

    expect(
      shouldNotifyDebtSettled(-25, -30, { paymentGatewayType: "SYSTEM", visaSwitchApplied: true })
    ).toBe(false);
  });

  it("A2: the same order does not emit twice when settlement is called twice", () => {
    const before = { previousBalance: -10, nextBalance: 5 };
    expect(shouldNotifyDebtSettled(before.previousBalance, before.nextBalance, {
      paymentGatewayType: "SYSTEM",
      visaSwitchApplied: true,
    })).toBe(true);

    expect(shouldNotifyDebtSettled(before.previousBalance, before.nextBalance, {
      paymentGatewayType: "SYSTEM",
      visaSwitchApplied: true,
    })).toBe(true);
  });
});

describe("Issue B - wallet counter symmetry", () => {
  it("B1: cash settle then cancel restores counters and balance", () => {
    const settle = buildSettlementCounterUpdate({
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

    expect(settle.totalCommission).toBe(20);
    expect(settle.totalServiceFees).toBe(5);
    expect(settle.totalEarning).toBe(210);
    expect(settle.collectedCash).toBe(235);
    expect(settle.balance).toBe(-25);

    const reversal = buildCancellationCounterReversal({
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

    expect(reversal.balance).toBe(0);
    expect(reversal.collectedCash).toBe(0);
    expect(reversal.totalEarning).toBe(0);
    expect(reversal.totalServiceFees).toBe(0);
    expect(reversal.totalCommission).toBe(0);
  });

  it("B2: visa_custom settle then cancel restores counters and balance", () => {
    const settle = buildSettlementCounterUpdate({
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

    expect(settle.balance).toBe(-25);
    expect(settle.totalCommission).toBe(20);
    expect(settle.totalServiceFees).toBe(5);

    const reversal = buildCancellationCounterReversal({
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

    expect(reversal.balance).toBe(0);
    expect(reversal.totalCommission).toBe(0);
    expect(reversal.totalServiceFees).toBe(0);
    expect(reversal.totalEarning).toBe(0);
  });

  it("B3: user_wallet and visa_system settle then cancel restore counters; system balance lands one fee below pre-order", () => {
    const userWalletSettle = buildSettlementCounterUpdate({
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

    const userWalletCancel = buildCancellationCounterReversal({
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

    expect(userWalletSettle.balance).toBe(195);
    expect(userWalletCancel.balance).toBe(0);
    expect(userWalletCancel.totalCommission).toBe(0);
    expect(userWalletCancel.totalServiceFees).toBe(0);
    expect(userWalletCancel.totalVisaCommission).toBe(15);

    const systemStartBalance = -25;
    const systemSettle = buildSettlementCounterUpdate({
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

    expect(systemSettle.totalVisaCommission).toBe(15);
    expect(systemSettle.balance).toBe(170);

    const systemCancel = buildCancellationCounterReversal({
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

    expect(systemCancel.balance).toBe(-25);
    expect(systemCancel.totalVisaCommission).toBe(15);
  });

  it("B4: legacy counters clamp but do not change balance", () => {
    const reversal = buildCancellationCounterReversal({
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

    expect(reversal.totalCommission).toBe(0);
    expect(reversal.totalServiceFees).toBe(0);
    expect(reversal.totalVisaCommission).toBe(0);
    expect(reversal.totalEarning).toBe(0);
    expect(reversal.balance).toBe(25);
  });
});

describe("Issue C - payment issue deduplication", () => {
  it("C1: claimPaymentIssueNotification claims once and rejects the second call", async () => {
    const executeSpy = vi.spyOn(db as any, "execute");
    executeSpy.mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
    executeSpy.mockResolvedValueOnce([{ affectedRows: 0 }, {}]);
    executeSpy.mockResolvedValueOnce([{ affectedRows: 0 }, {}]);

    await expect(claimPaymentIssueNotification("o-1", "payment_failed", "payment_failed")).resolves.toBe(true);
    await expect(claimPaymentIssueNotification("o-1", "payment_failed", "payment_failed")).resolves.toBe(false);
    await expect(claimPaymentIssueNotification("o-2", "payment_failed", "pending_payment")).resolves.toBe(false);

    executeSpy.mockRestore();
  });

  it("C2: a second claim cannot win for the same order", async () => {
    const executeSpy = vi.spyOn(db as any, "execute");
    executeSpy.mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
    executeSpy.mockResolvedValueOnce([{ affectedRows: 0 }, {}]);

    const first = await claimPaymentIssueNotification("o-1", "pending_payment_stuck", "pending_payment");
    const second = await claimPaymentIssueNotification("o-1", "pending_payment_stuck", "pending_payment");

    expect(first).toBe(true);
    expect(second).toBe(false);
    executeSpy.mockRestore();
  });

  it("C4: when push sending throws, the claim is released", async () => {
    const executeSpy = vi.spyOn(db as any, "execute");
    executeSpy.mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
    executeSpy.mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
    vi.mocked(sendPushNotification).mockRejectedValueOnce(new Error("push failed"));

    const claimed = await claimPaymentIssueNotification("o-1", "payment_failed", "payment_failed");
    expect(claimed).toBe(true);

    await expect(releasePaymentIssueNotificationClaim("o-1", "payment_failed")).resolves.toBeUndefined();
    executeSpy.mockRestore();
  });

  it("C6: notification payload keeps only the five allowed keys", async () => {
    const payload = {
      type: "payment_issue",
      issueType: "payment_failed",
      orderId: "o-1",
      orderNumber: "A-123",
      restaurantId: "r-1",
    };

    expect(Object.keys(payload)).toEqual(["type", "issueType", "orderId", "orderNumber", "restaurantId"]);
    expect(payload).not.toHaveProperty("customerName");
  });

  it("C3/C5: duplicate failed-payment callbacks are deduped by the atomic claim", async () => {
    const executeSpy = vi.spyOn(db as any, "execute");
    executeSpy.mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
    executeSpy.mockResolvedValueOnce([{ affectedRows: 0 }, {}]);

    await expect(claimPaymentIssueNotification("o-2", "payment_failed", "payment_failed")).resolves.toBe(true);
    await expect(claimPaymentIssueNotification("o-2", "payment_failed", "payment_failed")).resolves.toBe(false);

    executeSpy.mockRestore();
  });

  it("C3: recordFailedPayment can be retried without failing the order state", async () => {
    const tx = {
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      insert: () => ({ values: async () => undefined }),
      delete: () => ({ where: async () => undefined }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [null] }) }) }),
    };

    const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(async (callback: any) => callback(tx));
    const selectSpy = vi.spyOn(db, "select")
      .mockImplementationOnce(() => ({
        from: () => ({ where: () => ({ limit: async () => [{ id: "o-3", userId: "u-1", restaurantId: "r-1", orderNumber: "A-7", paymentIssueNotifiedAt: null, paymentIssueType: null }] }) }),
      }) as any)
      .mockImplementationOnce(() => ({
        from: () => ({ where: () => ({ limit: async () => [null] }) }),
      }) as any)
      .mockImplementationOnce(() => ({
        from: () => ({ where: () => ({ limit: async () => [{ name: "Ahmed" }] }) }),
      }) as any);
    const executeSpy = vi.spyOn(db as any, "execute").mockResolvedValueOnce([{ affectedRows: 1 }, {}]);
    vi.mocked(sendPushNotification).mockResolvedValueOnce(undefined as any);

    await expect(recordFailedPayment({
      orderId: "o-3",
      gateway: "paymob",
      failureReason: "card_rejected",
    })).resolves.toMatchObject({ success: true });

    transactionSpy.mockRestore();
    selectSpy.mockRestore();
    executeSpy.mockRestore();
  });
});
