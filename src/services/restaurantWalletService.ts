import { db } from "../models/connection";
import {
    restaurantWallets,
    restaurantWalletTransactions,
    restaurantBusinessPlans,
    restaurantSettings,
    orders,
    paymentMethods
} from "../models/schema";
import { eq, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

const roundMoney = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

export type PlatformType = "online_order_app" | "online_order_web" | "food_aggregator" | "mykeeto" | "pos";

/**
 * Maps any orderSource string to the corresponding platformType enum in restaurant_business_plans
 */
export function mapOrderSourceToPlatformType(orderSource: string): PlatformType {
    const normalized = String(orderSource ?? "").trim().toLowerCase();
    if (normalized === "my_keeto" || normalized === "mykeeto") return "mykeeto";
    if (normalized === "online_order_web") return "online_order_web";
    if (normalized === "food_aggregator") return "food_aggregator";
    if (normalized === "online_order_app") return "online_order_app";
    return "pos";
}

/**
 * Just-In-Time Visa Switch Helper
 * 
 * يُستدعى بعد كل أوردر مكتمل (delivered) أو عند بدء جلسة دفع.
 * يتحقق من شرط التحويل (amount أو date)، وإذا تحقق الشرط يحول البوابة
 * تلقائياً من CUSTOM إلى SYSTEM في نفس اللحظة.
 * 
 * @param restaurantId - معرف المطعم
 * @param addedServiceFee - السيرفيس فيز المضافة من الأوردر الحالي (لشرط المبلغ فقط)
 * @param executor - db أو tx (داخل transaction)
 */
export async function checkAndApplyVisaSwitch(
    restaurantId: string,
    addedServiceFee: number = 0,
    executor: any = db
): Promise<void> {
    // 1. جلب الإعدادات الحالية
    const [settings] = await executor
        .select({
            paymentGatewayType: restaurantSettings.paymentGatewayType,
            visaSwitchConditionType: restaurantSettings.visaSwitchConditionType,
            visaSwitchAmountThreshold: restaurantSettings.visaSwitchAmountThreshold,
            visaSwitchDayOfWeek: restaurantSettings.visaSwitchDayOfWeek,
            visaSwitchDayOfMonth: restaurantSettings.visaSwitchDayOfMonth,
            visaSwitchApplied: restaurantSettings.visaSwitchApplied,
            customGatewayAccumulatedFees: restaurantSettings.customGatewayAccumulatedFees,
        })
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, restaurantId))
        .limit(1);

    // لا توجد إعدادات أو البوابة مش CUSTOM أو السويتش حصل فعلاً → خروج
    if (!settings) return;
    if (settings.paymentGatewayType !== "CUSTOM") return;
    if (settings.visaSwitchApplied === true) return;
    if (!settings.visaSwitchConditionType || settings.visaSwitchConditionType === "none") return;

    let shouldSwitch = false;

    // ========================
    // شرط المبلغ (amount)
    // ========================
    if (settings.visaSwitchConditionType === "amount") {
        const threshold = parseFloat(settings.visaSwitchAmountThreshold as string || "0");
        const currentAccumulated = parseFloat(settings.customGatewayAccumulatedFees as string || "0");
        const newAccumulated = roundMoney(currentAccumulated + addedServiceFee);

        // تحديث العداد التراكمي أولاً
        await executor
            .update(restaurantSettings)
            .set({ customGatewayAccumulatedFees: newAccumulated.toFixed(2) })
            .where(eq(restaurantSettings.restaurantId, restaurantId));

        // فحص هل وصل أو تخطى الـ threshold
        if (threshold > 0 && newAccumulated >= threshold) {
            shouldSwitch = true;
        }
    }

    // ========================
    // شرط يوم الأسبوع (day_of_week)
    // ========================
    if (settings.visaSwitchConditionType === "day_of_week" && settings.visaSwitchDayOfWeek) {
        const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        const todayName = dayNames[new Date().getDay()]; // e.g. "saturday"
        if (todayName === String(settings.visaSwitchDayOfWeek).toLowerCase()) {
            shouldSwitch = true;
        }
    }

    // ========================
    // شرط يوم الشهر (day_of_month)
    // ========================
    if (settings.visaSwitchConditionType === "day_of_month" && settings.visaSwitchDayOfMonth != null) {
        const todayDayOfMonth = new Date().getDate(); // 1-31
        if (todayDayOfMonth === Number(settings.visaSwitchDayOfMonth)) {
            shouldSwitch = true;
        }
    }

    // ========================
    // تنفيذ التحويل الفعلي
    // ========================
    if (shouldSwitch) {
        await executor
            .update(restaurantSettings)
            .set({
                paymentGatewayType: "SYSTEM",
                visaSwitchApplied: true,
                gatewayAutoSwitchTriggeredAt: new Date(),
            })
            .where(eq(restaurantSettings.restaurantId, restaurantId));
    }
}

/**
 * 1. Fetch fees and commission based on restaurantBusinessPlans for the specific platform
 */
export async function getBusinessPlanFees(params: {
    restaurantId: string;
    orderSource: string;
    subtotal: number;
    executor?: any;
}) {
    const { restaurantId, orderSource, subtotal, executor = db } = params;
    const platformType = mapOrderSourceToPlatformType(orderSource);

    const [plan] = await executor
        .select()
        .from(restaurantBusinessPlans)
        .where(
            and(
                eq(restaurantBusinessPlans.restaurantId, restaurantId),
                eq(restaurantBusinessPlans.platformType, platformType)
            )
        )
        .limit(1);

    if (!plan) {
        return {
            planFound: false,
            platformType,
            commissionRate: 0,
            serviceFee: 0,
            appCommission: 0,
        };
    }

    const commissionRate = parseFloat(plan.commissionRate as string || "0");
    const serviceFee = parseFloat(plan.serviceFee as string || "0");
    const appCommission = roundMoney(subtotal * (commissionRate / 100));

    return {
        planFound: true,
        platformType,
        commissionRate,
        serviceFee,
        appCommission,
    };
}

/**
 * Helper to get or initialize a restaurant wallet row with FOR UPDATE locking
 */
export async function getOrCreateWallet(restaurantId: string, tx: any) {
    let [wallet] = await tx
        .select()
        .from(restaurantWallets)
        .where(eq(restaurantWallets.restaurantId, restaurantId))
        .for("update");

    if (!wallet) {
        await tx.insert(restaurantWallets).values({
            id: uuidv4(),
            restaurantId,
            balance: "0.00",
            collectedCash: "0.00",
            pendingWithdraw: "0.00",
            totalWithdrawn: "0.00",
            totalEarning: "0.00",
        });

        [wallet] = await tx
            .select()
            .from(restaurantWallets)
            .where(eq(restaurantWallets.restaurantId, restaurantId))
            .for("update");
    }

    return wallet;
}

export async function chargePendingServiceFee(
    orderId: string,
    tx: any,
    chargeTiming: "cash_pending" | "custom_paid"
) {
    const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");

    if (!order) return;

    const { isCash } = await resolvePaymentTypeAndGateway({
        restaurantId: order.restaurantId,
        paymentMethodId: order.paymentMethod,
        paymentGateway: order.paymentGateway,
        orderGatewayType: order.paymentGatewayType,
        executor: tx,
    });

    if (chargeTiming === "cash_pending") {
        if (!isCash || order.status !== "pending") return;
    } else if (isCash || order.paymentStatus !== "paid" || order.paymentGatewayType !== "CUSTOM") {
        return;
    }

    const serviceFee = parseFloat(order.serviceFee as string || "0");
    if (serviceFee <= 0) return;

    const [existingCharge] = await tx
        .select({ id: restaurantWalletTransactions.id })
        .from(restaurantWalletTransactions)
        .where(and(
            eq(restaurantWalletTransactions.orderId, order.id),
            eq(restaurantWalletTransactions.type, "adjustment"),
            eq(restaurantWalletTransactions.method, "pending_service_fee")
        ))
        .limit(1);

    if (existingCharge) return;

    const wallet = await getOrCreateWallet(order.restaurantId, tx);
    const balanceBefore = parseFloat(wallet.balance as string || "0");
    const balanceAfter = roundMoney(balanceBefore - serviceFee);
    const totalServiceFees = parseFloat(wallet.totalServiceFees as string || "0");

    await tx.update(restaurantWallets)
        .set({
            balance: balanceAfter.toFixed(2),
            totalServiceFees: roundMoney(totalServiceFees + serviceFee).toFixed(2),
            updatedAt: new Date(),
        })
        .where(eq(restaurantWallets.id, wallet.id));

    await tx.insert(restaurantWalletTransactions).values({
        id: uuidv4(),
        restaurantId: order.restaurantId,
        orderId: order.id,
        type: "adjustment",
        amount: (-serviceFee).toFixed(2),
        balanceBefore: balanceBefore.toFixed(2),
        balanceAfter: balanceAfter.toFixed(2),
        method: "pending_service_fee",
        reference: order.orderNumber,
        serviceFee: serviceFee.toFixed(2),
        commission: "0.00",
        orderAmount: order.totalAmount,
        note: chargeTiming === "cash_pending"
            ? `Pending-time service fee charged for cash order #${order.dailyOrderNumber || order.orderNumber}.`
            : `Pending-time service fee charged after CUSTOM payment confirmation for #${order.dailyOrderNumber || order.orderNumber}.`,
        createdAt: new Date(),
    });
}

/**
 * Checks whether an order is cash or digital (visa/online), and checks the gateway type
 */
export async function resolvePaymentTypeAndGateway(params: {
    restaurantId: string;
    paymentMethodId?: string | null;
    paymentGateway?: string | null;
    orderGatewayType?: "SYSTEM" | "CUSTOM" | null;
    executor?: any;
}) {
    const { restaurantId, paymentMethodId, paymentGateway, orderGatewayType, executor = db } = params;

    let isCash = false;
    let paymentMethodName = "Cash";

    if (paymentMethodId) {
        const [pm] = await executor
            .select()
            .from(paymentMethods)
            .where(eq(paymentMethods.id, paymentMethodId))
            .limit(1);

        if (pm) {
            paymentMethodName = pm.name || "Cash";
            const lowerName = (pm.name || "").toLowerCase();
            const lowerAr = (pm.nameAr || "").toLowerCase();
            isCash = lowerName.includes("cash") || lowerName.includes("cod") || lowerName.includes("استلام") || lowerAr.includes("نقدا") || lowerAr.includes("كاش");
        }
    } else {
        isCash = true;
    }

    // If explicit paymentGateway was set on order (kashier/paymob/geidea) -> it is digital
    if (paymentGateway) {
        isCash = false;
    }

    // If digital, check whether restaurant uses SYSTEM gateway or CUSTOM gateway
    let paymentGatewayType: "SYSTEM" | "CUSTOM" = orderGatewayType || "SYSTEM";
    if (!isCash && !orderGatewayType) {
        const [settings] = await executor
            .select({ paymentGatewayType: restaurantSettings.paymentGatewayType })
            .from(restaurantSettings)
            .where(eq(restaurantSettings.restaurantId, restaurantId))
            .limit(1);

        paymentGatewayType = settings?.paymentGatewayType || "SYSTEM";
    }

    return {
        isCash,
        paymentGatewayType,
        paymentMethodName,
    };
}

/**
 * 2. Settle Delivered Order in Restaurant Wallet
 * Runs when order status becomes 'delivered'
 */
export async function settleDeliveredOrder(orderId: string, tx: any) {
    const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");

    if (!order) return;
    if (order.paymentStatus && order.paymentStatus !== "paid") return;

    // Idempotency check: don't settle the same order twice
    const [existingTx] = await tx
        .select({ id: restaurantWalletTransactions.id })
        .from(restaurantWalletTransactions)
        .where(
            and(
                eq(restaurantWalletTransactions.restaurantId, order.restaurantId),
                eq(restaurantWalletTransactions.reference, order.orderNumber),
                eq(restaurantWalletTransactions.type, "order_payment")
            )
        )
        .limit(1);

    if (existingTx) {
        return; // Already settled
    }

    const { isCash, paymentGatewayType } = await resolvePaymentTypeAndGateway({
        restaurantId: order.restaurantId,
        paymentMethodId: order.paymentMethod,
        paymentGateway: order.paymentGateway,
        orderGatewayType: order.paymentGatewayType,
        executor: tx,
    });

    const subtotal = parseFloat(order.subtotal as string || "0");
    const deliveryFee = parseFloat(order.deliveryFee as string || "0");
    const serviceFee = parseFloat(order.serviceFee as string || "0");
    const appCommission = parseFloat(order.appCommission as string || "0");
    const totalAmount = parseFloat(order.totalAmount as string || "0");

    const [pendingServiceFeeTx] = await tx
        .select({ id: restaurantWalletTransactions.id })
        .from(restaurantWalletTransactions)
        .where(and(
            eq(restaurantWalletTransactions.orderId, order.id),
            eq(restaurantWalletTransactions.type, "adjustment"),
            eq(restaurantWalletTransactions.method, "pending_service_fee")
        ))
        .limit(1);

    const [serviceFeeRefundTx] = await tx
        .select({ id: restaurantWalletTransactions.id })
        .from(restaurantWalletTransactions)
        .where(and(
            eq(restaurantWalletTransactions.orderId, order.id),
            eq(restaurantWalletTransactions.type, "adjustment"),
            eq(restaurantWalletTransactions.method, "user_service_fee_refund")
        ))
        .limit(1);

    const pendingFeeAlreadyCharged = Boolean(pendingServiceFeeTx) && !serviceFeeRefundTx;
    const settlementServiceFee = pendingFeeAlreadyCharged ? 0 : serviceFee;
    const appDues = roundMoney(appCommission + settlementServiceFee);
    const restaurantEarning = roundMoney(subtotal + deliveryFee - appCommission);

    const wallet = await getOrCreateWallet(order.restaurantId, tx);

    const currentBalance = parseFloat(wallet.balance as string || "0");
    const currentCollectedCash = parseFloat(wallet.collectedCash as string || "0");
    const currentTotalEarning = parseFloat(wallet.totalEarning as string || "0");

    let newBalance = currentBalance;
    let newCollectedCash = currentCollectedCash;
    const newTotalEarning = roundMoney(currentTotalEarning + restaurantEarning);

    let transactionAmount = 0;
    let transactionNote = "";

    if (isCash) {
        // CASH PAYMENT:
        // Restaurant/Courier collected 100% of the money in hand.
        // Restaurant owes SuperAdmin the app commission & service fee (appDues).
        // Restaurant balance with SuperAdmin DECREASES by appDues.
        newCollectedCash = roundMoney(currentCollectedCash + totalAmount);
        newBalance = roundMoney(currentBalance - appDues);
        transactionAmount = -appDues;
        transactionNote = `Delivered order #${order.dailyOrderNumber || order.orderNumber}; platform=${mapOrderSourceToPlatformType(order.orderSource)}; subtotal=${subtotal.toFixed(2)}; delivery=${deliveryFee.toFixed(2)}; commission=${appCommission.toFixed(2)}; serviceFee=${serviceFee.toFixed(2)}; total=${totalAmount.toFixed(2)}; restaurant owes platform=${appDues.toFixed(2)}; cash collected.`;
    } else if (paymentGatewayType === "SYSTEM") {
        // DIGITAL PAYMENT (SYSTEM GATEWAY):
        // SuperAdmin collected 100% of the customer's money in SuperAdmin's payment gateway account.
        // SuperAdmin OWES the restaurant their net earning (subtotal + deliveryFee - appCommission).
        // Restaurant balance with SuperAdmin INCREASES by restaurantEarning.
        newBalance = roundMoney(currentBalance + restaurantEarning);
        transactionAmount = restaurantEarning;
        transactionNote = `Delivered order #${order.dailyOrderNumber || order.orderNumber}; platform=${mapOrderSourceToPlatformType(order.orderSource)}; subtotal=${subtotal.toFixed(2)}; delivery=${deliveryFee.toFixed(2)}; commission=${appCommission.toFixed(2)}; serviceFee=${serviceFee.toFixed(2)}; total=${totalAmount.toFixed(2)}; payment=SYSTEM; platform owes restaurant=${restaurantEarning.toFixed(2)}.`;
    } else {
        // DIGITAL PAYMENT (CUSTOM GATEWAY):
        // Customer paid directly into the restaurant's own payment gateway account.
        // Restaurant received 100% of the money in their own merchant account.
        // Restaurant OWES SuperAdmin the commission & service fee (appDues).
        // Restaurant balance with SuperAdmin DECREASES by appDues (identical to cash).
        newBalance = roundMoney(currentBalance - appDues);
        transactionAmount = -appDues;
        transactionNote = `Delivered order #${order.dailyOrderNumber || order.orderNumber}; platform=${mapOrderSourceToPlatformType(order.orderSource)}; subtotal=${subtotal.toFixed(2)}; delivery=${deliveryFee.toFixed(2)}; commission=${appCommission.toFixed(2)}; serviceFee=${settlementServiceFee.toFixed(2)}; total=${totalAmount.toFixed(2)}; payment=CUSTOM; restaurant owes platform=${appDues.toFixed(2)}.`;
        await checkAndApplyVisaSwitch(order.restaurantId, serviceFee, tx);
    }

    // Update restaurant wallet
    await tx
        .update(restaurantWallets)
        .set({
            balance: newBalance.toFixed(2),
            collectedCash: newCollectedCash.toFixed(2),
            totalEarning: newTotalEarning.toFixed(2),
            updatedAt: new Date()
        })
        .where(eq(restaurantWallets.id, wallet.id));

    // Record wallet transaction
    await tx.insert(restaurantWalletTransactions).values({
        id: uuidv4(),
        restaurantId: order.restaurantId,
        orderId: order.id,
        type: "order_payment",
        amount: transactionAmount.toFixed(2),
        balanceBefore: currentBalance.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        method: isCash ? "cash" : `visa_${paymentGatewayType.toLowerCase()}`,
        reference: order.orderNumber,
        // تفاصيل الرسوم الخاصة بهذا الأوردر بالتحديد
        serviceFee: settlementServiceFee.toFixed(2),
        commission: appCommission.toFixed(2),
        orderAmount: totalAmount.toFixed(2),
        note: transactionNote,
        createdAt: new Date()
    });
}

/**
 * 3. Handle Cancelled Order
 * Checks if cancellation was by 'user' or 'restaurant'
 */
export async function handleCancelledOrder(params: {
    orderId: string;
    cancelReasonType: "user" | "restaurant";
    tx: any;
}) {
    const { orderId, cancelReasonType, tx } = params;

    const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");

    if (!order) return;

    // Was this order ever settled as "delivered" before?
    const [settledTx] = await tx
        .select()
        .from(restaurantWalletTransactions)
        .where(
            and(
                eq(restaurantWalletTransactions.restaurantId, order.restaurantId),
                eq(restaurantWalletTransactions.reference, order.orderNumber),
                eq(restaurantWalletTransactions.type, "order_payment")
            )
        )
        .limit(1);

    // Was a service fee already charged while the order was pending (cash,
    // or CUSTOM-gateway once charged on payment confirmation)?
    const [pendingServiceFeeTx] = await tx
        .select()
        .from(restaurantWalletTransactions)
        .where(and(
            eq(restaurantWalletTransactions.orderId, order.id),
            eq(restaurantWalletTransactions.type, "adjustment"),
            eq(restaurantWalletTransactions.method, "pending_service_fee")
        ))
        .limit(1);

    // Has that pending fee already been refunded once (avoid double refund
    // if this function somehow runs twice for the same order)?
    const [serviceFeeRefundTx] = await tx
        .select({ id: restaurantWalletTransactions.id })
        .from(restaurantWalletTransactions)
        .where(and(
            eq(restaurantWalletTransactions.orderId, order.id),
            eq(restaurantWalletTransactions.type, "adjustment"),
            eq(restaurantWalletTransactions.method, "user_service_fee_refund")
        ))
        .limit(1);

    const subtotal = parseFloat(order.subtotal as string || "0");
    const deliveryFee = parseFloat(order.deliveryFee as string || "0");
    const serviceFee = parseFloat(order.serviceFee as string || "0");
    const appCommission = parseFloat(order.appCommission as string || "0");
    const totalAmount = parseFloat(order.totalAmount as string || "0");

    const pendingFeeAlreadyCharged = Boolean(pendingServiceFeeTx) && !serviceFeeRefundTx;
    const appDues = roundMoney(appCommission + (pendingFeeAlreadyCharged ? 0 : serviceFee));
    const restaurantEarning = roundMoney(subtotal + deliveryFee - appCommission);

    const wallet = await getOrCreateWallet(order.restaurantId, tx);
    let currentBalance = parseFloat(wallet.balance as string || "0");
    let currentCollectedCash = parseFloat(wallet.collectedCash as string || "0");
    let currentTotalEarning = parseFloat(wallet.totalEarning as string || "0");
    let currentFees = parseFloat((wallet as any).totalServiceFees as string || "0");
    let currentComm = parseFloat((wallet as any).totalCommission as string || "0");

    // ============================================================
    // Case 1: Order was already delivered/settled before this
    // cancellation — reverse the delivery settlement completely,
    // INCLUDING any pending-time service fee that was charged earlier
    // and never reversed.
    // ============================================================
    if (settledTx) {
        const { isCash, paymentGatewayType } = await resolvePaymentTypeAndGateway({
            restaurantId: order.restaurantId,
            paymentMethodId: order.paymentMethod,
            paymentGateway: order.paymentGateway,
            orderGatewayType: order.paymentGatewayType,
            executor: tx,
        });

        // Reverse whatever was actually charged/credited AT settlement time.
        const settledDues = roundMoney(appCommission + parseFloat(settledTx.serviceFee as string || "0"));

        if (isCash) {
            currentBalance = roundMoney(currentBalance + settledDues);
            currentCollectedCash = roundMoney(currentCollectedCash - totalAmount);
        } else if (paymentGatewayType === "SYSTEM") {
            currentBalance = roundMoney(currentBalance - restaurantEarning);
        } else {
            currentBalance = roundMoney(currentBalance + settledDues);
        }
        currentTotalEarning = roundMoney(currentTotalEarning - restaurantEarning);

        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId: order.restaurantId,
            orderId: order.id,
            type: "adjustment",
            amount: isCash || paymentGatewayType === "CUSTOM" ? `+${settledDues.toFixed(2)}` : `-${restaurantEarning.toFixed(2)}`,
            balanceBefore: wallet.balance as string,
            balanceAfter: currentBalance.toFixed(2),
            method: isCash ? "cash" : `visa_${paymentGatewayType.toLowerCase()}`,
            reference: order.orderNumber,
            note: `Reversal: order #${order.dailyOrderNumber || order.orderNumber}; platform=${mapOrderSourceToPlatformType(order.orderSource)}; commission=${appCommission.toFixed(2)}; settlementServiceFee=${parseFloat(settledTx.serviceFee as string || "0").toFixed(2)}; restaurantEarning=${restaurantEarning.toFixed(2)}; cancelledBy=${cancelReasonType}.`,
            createdAt: new Date()
        });

        // FIX: also refund the EARLIER pending-time service fee charge, if
        // one exists and hasn't been refunded yet — previously this was
        // silently left un-reversed when a delivered order was cancelled.
        if (pendingFeeAlreadyCharged) {
            const balanceBeforePendingRefund = currentBalance;
            currentBalance = roundMoney(currentBalance + serviceFee);
            currentFees = roundMoney(currentFees - serviceFee);

            await tx.insert(restaurantWalletTransactions).values({
                id: uuidv4(),
                restaurantId: order.restaurantId,
                orderId: order.id,
                type: "adjustment",
                amount: serviceFee.toFixed(2),
                balanceBefore: balanceBeforePendingRefund.toFixed(2),
                balanceAfter: currentBalance.toFixed(2),
                method: "user_service_fee_refund",
                reference: order.orderNumber,
                serviceFee: (-serviceFee).toFixed(2),
                commission: "0.00",
                orderAmount: totalAmount.toFixed(2),
                note: `Pending-time service fee refunded as part of delivered-order reversal for #${order.dailyOrderNumber || order.orderNumber}; refunded=${serviceFee.toFixed(2)}.`,
                createdAt: new Date()
            });
        }

        // Persist the fully-reversed wallet state and stop here — the
        // settlement reversal above (plus the pending-fee refund if any) is
        // the correct and COMPLETE adjustment for an order that was already
        // delivered. Do NOT also apply the "cancelled before delivery"
        // penalty logic below; that is a separate scenario.
        await tx.update(restaurantWallets)
            .set({
                balance: currentBalance.toFixed(2),
                collectedCash: currentCollectedCash.toFixed(2),
                totalEarning: currentTotalEarning.toFixed(2),
                totalServiceFees: currentFees.toFixed(2),
                updatedAt: new Date()
            })
            .where(eq(restaurantWallets.id, wallet.id));

        return;
    }

    // ============================================================
    // Case 2: Order was cancelled BEFORE delivery/settlement.
    // Only reached when settledTx is null (order never completed).
    // ============================================================
    const { isCash } = await resolvePaymentTypeAndGateway({
        restaurantId: order.restaurantId,
        paymentMethodId: order.paymentMethod,
        paymentGateway: order.paymentGateway,
        orderGatewayType: order.paymentGatewayType,
        executor: tx,
    });

    if (cancelReasonType === "restaurant" && (isCash || order.paymentStatus === "paid")) {
        // Restaurant cancelled an order that was never delivered: charge
        // the full appDues as a penalty (minus any serviceFee portion
        // already charged while pending, so it isn't double-counted).
        const balanceBefore = currentBalance;
        const balanceAfter = roundMoney(currentBalance - appDues);

        await tx.update(restaurantWallets)
            .set({
                balance: balanceAfter.toFixed(2),
                collectedCash: currentCollectedCash.toFixed(2),
                totalEarning: currentTotalEarning.toFixed(2),
                totalServiceFees: roundMoney(currentFees + (pendingFeeAlreadyCharged ? 0 : serviceFee)).toFixed(2),
                totalCommission: roundMoney(currentComm + appCommission).toFixed(2),
                updatedAt: new Date()
            })
            .where(eq(restaurantWallets.id, wallet.id));

        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId: order.restaurantId,
            orderId: order.id,
            type: "adjustment",
            amount: `-${appDues.toFixed(2)}`,
            balanceBefore: balanceBefore.toFixed(2),
            balanceAfter: balanceAfter.toFixed(2),
            method: "penalty",
            reference: order.orderNumber,
            serviceFee: (pendingFeeAlreadyCharged ? 0 : serviceFee).toFixed(2),
            commission: appCommission.toFixed(2),
            orderAmount: totalAmount.toFixed(2),
            note: `Cancellation penalty: order #${order.dailyOrderNumber || order.orderNumber}; platform=${mapOrderSourceToPlatformType(order.orderSource)}; cancelledBy=restaurant; commission=${appCommission.toFixed(2)}; serviceFee=${(pendingFeeAlreadyCharged ? 0 : serviceFee).toFixed(2)}; charged=${appDues.toFixed(2)}.`,
            createdAt: new Date()
        });
    } else {
        // No restaurant penalty applies; refund any pending-time fee already charged.
        // Refund any service fee that was already charged while pending.
        if (pendingFeeAlreadyCharged) {
            const balanceBefore = currentBalance;
            currentBalance = roundMoney(currentBalance + serviceFee);

            await tx.update(restaurantWallets)
                .set({
                    balance: currentBalance.toFixed(2),
                    collectedCash: currentCollectedCash.toFixed(2),
                    totalEarning: currentTotalEarning.toFixed(2),
                    totalServiceFees: roundMoney(currentFees - serviceFee).toFixed(2),
                    updatedAt: new Date()
                })
                .where(eq(restaurantWallets.id, wallet.id));

            await tx.insert(restaurantWalletTransactions).values({
                id: uuidv4(),
                restaurantId: order.restaurantId,
                orderId: order.id,
                type: "adjustment",
                amount: serviceFee.toFixed(2),
                balanceBefore: balanceBefore.toFixed(2),
                balanceAfter: currentBalance.toFixed(2),
                method: "user_service_fee_refund",
                reference: order.orderNumber,
                serviceFee: (-serviceFee).toFixed(2),
                commission: "0.00",
                orderAmount: totalAmount.toFixed(2),
                note: `Service fee refunded for order #${order.dailyOrderNumber || order.orderNumber}; cancelledBy=${cancelReasonType}; refunded=${serviceFee.toFixed(2)}.`,
                createdAt: new Date()
            });
        } else {
            // Nothing was ever charged for this order — just log a
            // zero-impact record for visibility/audit purposes.
            await tx.insert(restaurantWalletTransactions).values({
                id: uuidv4(),
                restaurantId: order.restaurantId,
                orderId: order.id,
                type: "adjustment",
                amount: "0.00",
                balanceBefore: currentBalance.toFixed(2),
                balanceAfter: currentBalance.toFixed(2),
                method: "cancellation",
                reference: order.orderNumber,
                note: `Order #${order.dailyOrderNumber || order.orderNumber} cancelled by ${cancelReasonType}; platform=${mapOrderSourceToPlatformType(order.orderSource)}; no restaurant fees charged.`,
                createdAt: new Date()
            });
        }
    }
}

/**
 * 4. Get Wallet Details with Financial Summary (Who owes Whom)
 */
export function buildWalletSummary(wallet: typeof restaurantWallets.$inferSelect) {
    const balance = parseFloat(wallet.balance as string || "0");
    const collectedCash = parseFloat(wallet.collectedCash as string || "0");
    const totalEarning = parseFloat(wallet.totalEarning as string || "0");
    const pendingWithdraw = parseFloat(wallet.pendingWithdraw as string || "0");
    const totalWithdrawn = parseFloat(wallet.totalWithdrawn as string || "0");

    let settlementStatus: "SUPERADMIN_OWES_RESTAURANT" | "RESTAURANT_OWES_SUPERADMIN" | "SETTLED" = "SETTLED";
    let explanationAr = "الحساب مصفّى بالكامل (لا توجد مديونيات معلقة).";
    let explanationEn = "Account is fully settled. No pending debt or receivables.";

    if (balance > 0) {
        settlementStatus = "SUPERADMIN_OWES_RESTAURANT";
        explanationAr = `للمطعم مستحقات لدى المنصة بقيمة ${balance.toFixed(2)} ج.م (أرباح صافية من مدفوعات إلكترونية عبر بوابة المنصة).`;
        explanationEn = `SuperAdmin owes restaurant ${balance.toFixed(2)} EGP (Net earnings from digital payments on System gateway).`;
    } else if (balance < 0) {
        settlementStatus = "RESTAURANT_OWES_SUPERADMIN";
        explanationAr = `على المطعم مستحقات واجبة السداد للمنصة بقيمة ${Math.abs(balance).toFixed(2)} ج.م (عمولات ورسوم خدمة لطلبات كاش أو بوابات دفع خاصة بالمطعم).`;
        explanationEn = `Restaurant owes SuperAdmin ${Math.abs(balance).toFixed(2)} EGP (App commission & service fees for cash or custom gateway orders).`;
    }

    return {
        id: wallet.id,
        restaurantId: wallet.restaurantId,
        balance: balance.toFixed(2),
        collectedCash: collectedCash.toFixed(2),
        pendingWithdraw: pendingWithdraw.toFixed(2),
        totalWithdrawn: totalWithdrawn.toFixed(2),
        totalEarning: totalEarning.toFixed(2),
        settlementSummary: {
            status: settlementStatus,
            amount: Math.abs(balance).toFixed(2),
            explanationAr,
            explanationEn,
        },
        updatedAt: wallet.updatedAt,
    };
}
