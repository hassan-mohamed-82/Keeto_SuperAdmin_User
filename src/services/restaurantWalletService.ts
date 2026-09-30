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
    if (normalized === "pos") return "pos";
    return "online_order_app";
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

    const appDues = roundMoney(appCommission + serviceFee);
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
        transactionNote = `Delivered order #${order.dailyOrderNumber || order.orderNumber}; platform=${mapOrderSourceToPlatformType(order.orderSource)}; subtotal=${subtotal.toFixed(2)}; delivery=${deliveryFee.toFixed(2)}; commission=${appCommission.toFixed(2)}; serviceFee=${serviceFee.toFixed(2)}; total=${totalAmount.toFixed(2)}; payment=CUSTOM; restaurant owes platform=${appDues.toFixed(2)}.`;
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
        type: "order_payment",
        amount: transactionAmount.toFixed(2),
        balanceBefore: currentBalance.toFixed(2),
        balanceAfter: newBalance.toFixed(2),
        method: isCash ? "cash" : `visa_${paymentGatewayType.toLowerCase()}`,
        reference: order.orderNumber,
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

    // Check if this order was already settled as delivered previously
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

    const subtotal = parseFloat(order.subtotal as string || "0");
    const deliveryFee = parseFloat(order.deliveryFee as string || "0");
    const serviceFee = parseFloat(order.serviceFee as string || "0");
    const appCommission = parseFloat(order.appCommission as string || "0");
    const totalAmount = parseFloat(order.totalAmount as string || "0");

    const appDues = roundMoney(appCommission + serviceFee);
    const restaurantEarning = roundMoney(subtotal + deliveryFee - appCommission);

    const wallet = await getOrCreateWallet(order.restaurantId, tx);
    let currentBalance = parseFloat(wallet.balance as string || "0");
    let currentCollectedCash = parseFloat(wallet.collectedCash as string || "0");
    let currentTotalEarning = parseFloat(wallet.totalEarning as string || "0");

    // Case 1: Order was already delivered before being cancelled/refunded -> Revert delivery settlement
    if (settledTx) {
        const { isCash, paymentGatewayType } = await resolvePaymentTypeAndGateway({
            restaurantId: order.restaurantId,
            paymentMethodId: order.paymentMethod,
            paymentGateway: order.paymentGateway,
            orderGatewayType: order.paymentGatewayType,
            executor: tx,
        });

        if (isCash) {
            currentBalance = roundMoney(currentBalance + appDues);
            currentCollectedCash = roundMoney(currentCollectedCash - totalAmount);
        } else if (paymentGatewayType === "SYSTEM") {
            currentBalance = roundMoney(currentBalance - restaurantEarning);
        } else {
            currentBalance = roundMoney(currentBalance + appDues);
        }
        currentTotalEarning = roundMoney(currentTotalEarning - restaurantEarning);

        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId: order.restaurantId,
            type: "adjustment",
            amount: isCash || paymentGatewayType === "CUSTOM" ? `+${appDues.toFixed(2)}` : `-${restaurantEarning.toFixed(2)}`,
            balanceBefore: wallet.balance as string,
            balanceAfter: currentBalance.toFixed(2),
            method: isCash ? "cash" : `visa_${paymentGatewayType.toLowerCase()}`,
            reference: order.orderNumber,
            note: `Reversal: order #${order.dailyOrderNumber || order.orderNumber}; platform=${mapOrderSourceToPlatformType(order.orderSource)}; commission=${appCommission.toFixed(2)}; serviceFee=${serviceFee.toFixed(2)}; restaurantEarning=${restaurantEarning.toFixed(2)}; cancelledBy=${cancelReasonType}.`,
            createdAt: new Date()
        });
    }

    // Case 2: Cancellation penalty logic
    if (cancelReasonType === "restaurant") {
        // Restaurant cancelled the order: Restaurant is penalized by the app dues (commission + service fee)
        const balanceBefore = currentBalance;
        const balanceAfter = roundMoney(currentBalance - appDues);

        await tx.update(restaurantWallets)
            .set({
                balance: balanceAfter.toFixed(2),
                collectedCash: currentCollectedCash.toFixed(2),
                totalEarning: currentTotalEarning.toFixed(2),
                updatedAt: new Date()
            })
            .where(eq(restaurantWallets.id, wallet.id));

        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId: order.restaurantId,
            type: "adjustment",
            amount: `-${appDues.toFixed(2)}`,
            balanceBefore: balanceBefore.toFixed(2),
            balanceAfter: balanceAfter.toFixed(2),
            method: "penalty",
            reference: order.orderNumber,
            note: `Cancellation penalty: order #${order.dailyOrderNumber || order.orderNumber}; platform=${mapOrderSourceToPlatformType(order.orderSource)}; cancelledBy=restaurant; commission=${appCommission.toFixed(2)}; serviceFee=${serviceFee.toFixed(2)}; charged=${appDues.toFixed(2)}.`,
            createdAt: new Date()
        });
    } else {
        // Cancelled by USER:
        // Restaurant is NOT penalized. If there was a previous delivery reversal, update the wallet state.
        if (settledTx) {
            await tx.update(restaurantWallets)
                .set({
                    balance: currentBalance.toFixed(2),
                    collectedCash: currentCollectedCash.toFixed(2),
                    totalEarning: currentTotalEarning.toFixed(2),
                    updatedAt: new Date()
                })
                .where(eq(restaurantWallets.id, wallet.id));
        } else {
            await tx.insert(restaurantWalletTransactions).values({
                id: uuidv4(),
                restaurantId: order.restaurantId,
                type: "adjustment",
                amount: "0.00",
                balanceBefore: currentBalance.toFixed(2),
                balanceAfter: currentBalance.toFixed(2),
                method: "cancellation",
                reference: order.orderNumber,
                note: `Order #${order.dailyOrderNumber || order.orderNumber} cancelled by user; platform=${mapOrderSourceToPlatformType(order.orderSource)}; no restaurant fees charged.`,
                createdAt: new Date()
            });
        }
        // If the order was in pending/preparing and user cancelled:
        // Restaurant wallet is not affected at all (0 dues charged).
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
