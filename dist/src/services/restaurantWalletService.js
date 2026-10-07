"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapOrderSourceToPlatformType = mapOrderSourceToPlatformType;
exports.applyGatewaySwitch = applyGatewaySwitch;
exports.checkAndApplyVisaSwitch = checkAndApplyVisaSwitch;
exports.chargeGatewayFeeOnRefund = chargeGatewayFeeOnRefund;
exports.getBusinessPlanFees = getBusinessPlanFees;
exports.getOrCreateWallet = getOrCreateWallet;
exports.shouldNotifyDebtSettled = shouldNotifyDebtSettled;
exports.buildSettlementCounterUpdate = buildSettlementCounterUpdate;
exports.buildCancellationCounterReversal = buildCancellationCounterReversal;
exports.chargePendingServiceFee = chargePendingServiceFee;
exports.resolvePaymentTypeAndGateway = resolvePaymentTypeAndGateway;
exports.settleDeliveredOrder = settleDeliveredOrder;
exports.handleCancelledOrder = handleCancelledOrder;
exports.buildWalletSummary = buildWalletSummary;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const roundMoney = (num) => Math.round((num + Number.EPSILON) * 100) / 100;
/**
 * Maps any orderSource string to the corresponding platformType enum in restaurant_business_plans
 */
function mapOrderSourceToPlatformType(orderSource) {
    const normalized = String(orderSource ?? "").trim().toLowerCase();
    if (normalized === "my_keeto" || normalized === "mykeeto")
        return "mykeeto";
    if (normalized === "online_order_web")
        return "online_order_web";
    if (normalized === "food_aggregator")
        return "food_aggregator";
    if (normalized === "online_order_app")
        return "online_order_app";
    return "pos";
}
async function applyGatewaySwitch(executor, { restaurantId, toType, trigger, balanceAtSwitch, adminId, }) {
    const [settings] = await executor
        .select({
        paymentGatewayType: schema_1.restaurantSettings.paymentGatewayType,
        visaSwitchApplied: schema_1.restaurantSettings.visaSwitchApplied,
        gatewayAutoSwitchTriggeredAt: schema_1.restaurantSettings.gatewayAutoSwitchTriggeredAt,
    })
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
        .limit(1);
    const currentType = settings?.paymentGatewayType ?? "SYSTEM";
    const settingsUpdate = {
        paymentGatewayType: toType,
        ...(toType === "SYSTEM"
            ? {
                visaSwitchApplied: true,
                gatewayAutoSwitchTriggeredAt: new Date(),
            }
            : {
                visaSwitchApplied: false,
                gatewayAutoSwitchTriggeredAt: null,
            }),
    };
    await executor
        .update(schema_1.restaurantSettings)
        .set(settingsUpdate)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId));
    await executor.insert(schema_1.gatewaySwitchLog).values({
        id: (0, uuid_1.v4)(),
        restaurantId,
        fromType: currentType,
        toType,
        trigger,
        balanceAtSwitch: Number(balanceAtSwitch || 0).toFixed(2),
        adminId: adminId ?? null,
        createdAt: new Date(),
    });
    if (toType === "SYSTEM") {
        await executor.insert(schema_1.notifications).values({
            id: (0, uuid_1.v4)(),
            recipientType: "restaurant",
            recipientId: restaurantId,
            title: "Payment gateway switched to SYSTEM",
            body: "Online-payment revenue will now be offset against the outstanding balance.",
            data: {
                type: "gateway_switch",
                restaurantId,
                fromType: currentType,
                toType,
                trigger,
                balanceAtSwitch: Number(balanceAtSwitch || 0).toFixed(2),
            },
            isRead: false,
            createdAt: new Date(),
        });
    }
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
async function checkAndApplyVisaSwitch(restaurantId, addedServiceFee = 0, executor = connection_1.db) {
    const [settings] = await executor
        .select({
        paymentGatewayType: schema_1.restaurantSettings.paymentGatewayType,
        visaSwitchConditionType: schema_1.restaurantSettings.visaSwitchConditionType,
        visaSwitchAmountThreshold: schema_1.restaurantSettings.visaSwitchAmountThreshold,
        visaSwitchDayOfWeek: schema_1.restaurantSettings.visaSwitchDayOfWeek,
        visaSwitchDayOfMonth: schema_1.restaurantSettings.visaSwitchDayOfMonth,
        visaSwitchApplied: schema_1.restaurantSettings.visaSwitchApplied,
    })
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
        .limit(1);
    if (!settings)
        return;
    if (settings.paymentGatewayType !== "CUSTOM")
        return;
    if (settings.visaSwitchApplied === true)
        return;
    if (!settings.visaSwitchConditionType || settings.visaSwitchConditionType === "none")
        return;
    const [wallet] = await executor
        .select({ balance: schema_1.restaurantWallets.balance })
        .from(schema_1.restaurantWallets)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId))
        .limit(1);
    const walletBalance = parseFloat(String(wallet?.balance ?? "0"));
    let shouldSwitch = false;
    let trigger = "amount";
    if (settings.visaSwitchConditionType === "amount") {
        const threshold = parseFloat(String(settings.visaSwitchAmountThreshold ?? "0"));
        const debt = Math.max(0, -walletBalance);
        shouldSwitch = threshold > 0 && debt >= threshold;
        trigger = "amount";
    }
    if (settings.visaSwitchConditionType === "day_of_week" && settings.visaSwitchDayOfWeek) {
        const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        const todayName = dayNames[new Date().getDay()];
        if (walletBalance < 0 && todayName === String(settings.visaSwitchDayOfWeek).toLowerCase()) {
            shouldSwitch = true;
            trigger = "day_of_week";
        }
    }
    if (settings.visaSwitchConditionType === "day_of_month" && settings.visaSwitchDayOfMonth != null) {
        const todayDayOfMonth = new Date().getDate();
        if (walletBalance < 0 && todayDayOfMonth === Number(settings.visaSwitchDayOfMonth)) {
            shouldSwitch = true;
            trigger = "day_of_month";
        }
    }
    if (shouldSwitch) {
        await applyGatewaySwitch(executor, {
            restaurantId,
            toType: "SYSTEM",
            trigger,
            balanceAtSwitch: walletBalance,
        });
    }
}
async function chargeGatewayFeeOnRefund(tx, order, refundAmount, options) {
    const gatewayFee = Math.max(0, Number(refundAmount ?? parseFloat(String(order?.visaCommission ?? "0"))));
    if (gatewayFee <= 0)
        return;
    const [existingAdjustment] = await tx
        .select({ id: schema_1.restaurantWalletTransactions.id })
        .from(schema_1.restaurantWalletTransactions)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.orderId, order.id), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.type, "adjustment"), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.method, "gateway_fee_on_refund")))
        .limit(1);
    if (existingAdjustment)
        return;
    const wallet = await getOrCreateWallet(order.restaurantId, tx);
    const balanceBefore = parseFloat(wallet.balance || "0");
    const currentVisaCommission = parseFloat(wallet.totalVisaCommission || "0");
    const balanceAfter = roundMoney(balanceBefore - gatewayFee);
    const totalVisaCommissionAfter = roundMoney(options?.alreadyCounted ? currentVisaCommission : currentVisaCommission + gatewayFee);
    await tx.update(schema_1.restaurantWallets)
        .set({
        balance: balanceAfter.toFixed(2),
        totalVisaCommission: totalVisaCommissionAfter.toFixed(2),
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.id, wallet.id));
    await tx.insert(schema_1.restaurantWalletTransactions).values({
        id: (0, uuid_1.v4)(),
        restaurantId: order.restaurantId,
        orderId: order.id,
        type: "adjustment",
        amount: (-gatewayFee).toFixed(2),
        balanceBefore: balanceBefore.toFixed(2),
        balanceAfter: balanceAfter.toFixed(2),
        method: "gateway_fee_on_refund",
        reference: order.orderNumber,
        serviceFee: "0.00",
        commission: "0.00",
        visaCommission: gatewayFee.toFixed(2),
        orderAmount: String(order.totalAmount ?? "0.00"),
        note: options?.note ?? `Gateway fee charged on refund for SYSTEM visa order #${order.dailyOrderNumber || order.orderNumber}.`,
        createdAt: new Date(),
    });
}
/**
 * 1. Fetch fees and commission based on restaurantBusinessPlans for the specific platform
 */
async function getBusinessPlanFees(params) {
    const { restaurantId, orderSource, subtotal, executor = connection_1.db } = params;
    const platformType = mapOrderSourceToPlatformType(orderSource);
    const [plan] = await executor
        .select()
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.platformType, platformType)))
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
    const commissionRate = parseFloat(plan.commissionRate || "0");
    const serviceFee = parseFloat(plan.serviceFee || "0");
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
async function getOrCreateWallet(restaurantId, tx) {
    let [wallet] = await tx
        .select()
        .from(schema_1.restaurantWallets)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId))
        .for("update");
    if (!wallet) {
        await tx.insert(schema_1.restaurantWallets).values({
            id: (0, uuid_1.v4)(),
            restaurantId,
            balance: "0.00",
            collectedCash: "0.00",
            pendingWithdraw: "0.00",
            totalWithdrawn: "0.00",
            totalEarning: "0.00",
        });
        [wallet] = await tx
            .select()
            .from(schema_1.restaurantWallets)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId))
            .for("update");
    }
    return wallet;
}
function shouldNotifyDebtSettled(previousBalance, nextBalance, settings) {
    if (previousBalance >= 0 || nextBalance < 0)
        return false;
    if (!settings || settings.paymentGatewayType !== "SYSTEM" || settings.visaSwitchApplied !== true)
        return false;
    return true;
}
function buildSettlementCounterUpdate(params) {
    const { paymentKind, currentBalance, currentCollectedCash, currentTotalEarning, currentTotalServiceFees, currentTotalCommission, currentTotalVisaCommission, subtotal, deliveryFee, settlementServiceFee, appCommission, discountAmount, orderVisaComm, totalAmount, } = params;
    if (paymentKind === "cash") {
        const restaurantEarning = roundMoney(subtotal + deliveryFee - appCommission);
        const appDues = roundMoney(appCommission + settlementServiceFee);
        return {
            balance: roundMoney(currentBalance - appDues),
            collectedCash: roundMoney(currentCollectedCash + totalAmount),
            totalEarning: roundMoney(currentTotalEarning + restaurantEarning),
            totalServiceFees: roundMoney(currentTotalServiceFees + settlementServiceFee),
            totalCommission: roundMoney(currentTotalCommission + appCommission),
            totalVisaCommission: currentTotalVisaCommission,
        };
    }
    if (paymentKind === "visa_system" || paymentKind === "user_wallet") {
        const restaurantCredit = roundMoney(subtotal + deliveryFee - appCommission - discountAmount - orderVisaComm);
        return {
            balance: roundMoney(currentBalance + restaurantCredit),
            collectedCash: currentCollectedCash,
            totalEarning: roundMoney(currentTotalEarning + restaurantCredit),
            totalServiceFees: roundMoney(currentTotalServiceFees + settlementServiceFee),
            totalCommission: roundMoney(currentTotalCommission + appCommission),
            totalVisaCommission: roundMoney(currentTotalVisaCommission + orderVisaComm),
        };
    }
    const restaurantEarning = roundMoney(subtotal + deliveryFee - appCommission);
    const customDues = roundMoney(appCommission + settlementServiceFee);
    return {
        balance: roundMoney(currentBalance - customDues),
        collectedCash: currentCollectedCash,
        totalEarning: roundMoney(currentTotalEarning + restaurantEarning),
        totalServiceFees: roundMoney(currentTotalServiceFees + settlementServiceFee),
        totalCommission: roundMoney(currentTotalCommission + appCommission),
        totalVisaCommission: currentTotalVisaCommission,
    };
}
function buildCancellationCounterReversal(params) {
    const { paymentKind, currentBalance, currentCollectedCash, currentTotalEarning, currentTotalServiceFees, currentTotalCommission, currentTotalVisaCommission, subtotal, deliveryFee, settledAmount, settledServiceFee, settledCommission, settledVisaComm, totalAmount, } = params;
    const settledRestaurantEarning = roundMoney(subtotal + deliveryFee - settledCommission);
    let collectedCash = currentCollectedCash;
    let totalEarning = currentTotalEarning;
    let totalServiceFees = currentTotalServiceFees;
    let totalCommission = currentTotalCommission;
    let totalVisaCommission = currentTotalVisaCommission;
    if (paymentKind === "cash") {
        collectedCash = Math.max(0, roundMoney(currentCollectedCash - totalAmount));
        totalEarning = Math.max(0, roundMoney(currentTotalEarning - settledRestaurantEarning));
        totalServiceFees = Math.max(0, roundMoney(currentTotalServiceFees - settledServiceFee));
        totalCommission = Math.max(0, roundMoney(currentTotalCommission - settledCommission));
    }
    else if (paymentKind === "visa_custom") {
        totalEarning = Math.max(0, roundMoney(currentTotalEarning - settledRestaurantEarning));
        totalServiceFees = Math.max(0, roundMoney(currentTotalServiceFees - settledServiceFee));
        totalCommission = Math.max(0, roundMoney(currentTotalCommission - settledCommission));
        totalVisaCommission = Math.max(0, roundMoney(currentTotalVisaCommission - settledVisaComm));
    }
    else {
        totalEarning = Math.max(0, roundMoney(currentTotalEarning - settledAmount));
        totalServiceFees = Math.max(0, roundMoney(currentTotalServiceFees - settledServiceFee));
        totalCommission = Math.max(0, roundMoney(currentTotalCommission - settledCommission));
        // SYSTEM and wallet settlements already counted the gateway fee separately on refund,
        // so this reversal must not subtract it again here.
    }
    return {
        balance: roundMoney(currentBalance - settledAmount),
        collectedCash,
        totalEarning,
        totalServiceFees,
        totalCommission,
        totalVisaCommission,
    };
}
async function chargePendingServiceFee(orderId, tx, chargeTiming) {
    const [order] = await tx
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
        .for("update");
    if (!order)
        return;
    const { isCash, paymentKind, paymentGatewayType } = await resolvePaymentTypeAndGateway({
        restaurantId: order.restaurantId,
        paymentMethodId: order.paymentMethod,
        paymentGateway: order.paymentGateway,
        orderGatewayType: order.paymentGatewayType,
        executor: tx,
    });
    if (chargeTiming === "cash_pending") {
        if (paymentKind !== "cash" || order.status !== "pending")
            return;
    }
    else if (paymentKind !== "visa_custom" || order.paymentStatus !== "paid" || paymentGatewayType !== "CUSTOM") {
        return;
    }
    const serviceFee = parseFloat(order.serviceFee || "0");
    if (serviceFee <= 0)
        return;
    const [existingCharge] = await tx
        .select({ id: schema_1.restaurantWalletTransactions.id })
        .from(schema_1.restaurantWalletTransactions)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.orderId, order.id), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.type, "adjustment"), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.method, "pending_service_fee")))
        .limit(1);
    if (existingCharge)
        return;
    const wallet = await getOrCreateWallet(order.restaurantId, tx);
    const balanceBefore = parseFloat(wallet.balance || "0");
    const balanceAfter = roundMoney(balanceBefore - serviceFee);
    const totalServiceFees = parseFloat(wallet.totalServiceFees || "0");
    await tx.update(schema_1.restaurantWallets)
        .set({
        balance: balanceAfter.toFixed(2),
        totalServiceFees: roundMoney(totalServiceFees + serviceFee).toFixed(2),
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.id, wallet.id));
    await tx.insert(schema_1.restaurantWalletTransactions).values({
        id: (0, uuid_1.v4)(),
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
    await checkAndApplyVisaSwitch(order.restaurantId, serviceFee, tx);
}
/**
 * Checks whether an order is cash or digital (visa/online), and checks the gateway type
 */
async function resolvePaymentTypeAndGateway(params) {
    const { restaurantId, paymentMethodId, paymentGateway, orderGatewayType, executor = connection_1.db } = params;
    let isCash = false;
    let paymentMethodName = "Cash";
    if (paymentMethodId) {
        const [pm] = await executor
            .select()
            .from(schema_1.paymentMethods)
            .where((0, drizzle_orm_1.eq)(schema_1.paymentMethods.id, paymentMethodId))
            .limit(1);
        if (pm) {
            paymentMethodName = pm.name || "Cash";
            const lowerName = (pm.name || "").toLowerCase();
            const lowerAr = (pm.nameAr || "").toLowerCase();
            isCash = lowerName.includes("cash") || lowerName.includes("cod") || lowerName.includes("استلام") || lowerAr.includes("نقدا") || lowerAr.includes("كاش");
        }
    }
    else {
        isCash = true;
    }
    if (paymentGateway) {
        isCash = false;
    }
    const walletLike = paymentMethodName.toLowerCase() === "wallet" || paymentMethodName.toLowerCase() === "my wallet" || paymentMethodName === "محفظتي" || paymentMethodName === "محفظتى";
    if (walletLike) {
        return {
            isCash: false,
            paymentGatewayType: "SYSTEM",
            paymentMethodName,
            paymentKind: "user_wallet",
        };
    }
    let paymentGatewayType = orderGatewayType || "SYSTEM";
    if (!isCash && !orderGatewayType) {
        const [settings] = await executor
            .select({ paymentGatewayType: schema_1.restaurantSettings.paymentGatewayType })
            .from(schema_1.restaurantSettings)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
            .limit(1);
        paymentGatewayType = settings?.paymentGatewayType || "SYSTEM";
    }
    const paymentKind = isCash ? "cash" : paymentGatewayType === "SYSTEM" ? "visa_system" : "visa_custom";
    return {
        isCash,
        paymentGatewayType,
        paymentMethodName,
        paymentKind,
    };
}
/**
 * 2. Settle Delivered Order in Restaurant Wallet
 * Runs when order status becomes 'delivered'
 */
async function settleDeliveredOrder(orderId, tx) {
    const [order] = await tx
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
        .for("update");
    if (!order)
        return;
    if (order.paymentStatus && order.paymentStatus !== "paid")
        return;
    const [existingTx] = await tx
        .select({ id: schema_1.restaurantWalletTransactions.id })
        .from(schema_1.restaurantWalletTransactions)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.restaurantId, order.restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.reference, order.orderNumber), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.type, "order_payment")))
        .limit(1);
    if (existingTx)
        return;
    const { isCash, paymentKind, paymentGatewayType } = await resolvePaymentTypeAndGateway({
        restaurantId: order.restaurantId,
        paymentMethodId: order.paymentMethod,
        paymentGateway: order.paymentGateway,
        orderGatewayType: order.paymentGatewayType,
        executor: tx,
    });
    const subtotal = parseFloat(order.subtotal || "0");
    const deliveryFee = parseFloat(order.deliveryFee || "0");
    const serviceFee = parseFloat(order.serviceFee || "0");
    const appCommission = parseFloat(order.appCommission || "0");
    const totalAmount = parseFloat(order.totalAmount || "0");
    const discountAmount = parseFloat(order.discountAmount || "0");
    const orderVisaComm = parseFloat(order.visaCommission || "0");
    const [pendingServiceFeeTx] = await tx
        .select({ id: schema_1.restaurantWalletTransactions.id })
        .from(schema_1.restaurantWalletTransactions)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.orderId, order.id), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.type, "adjustment"), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.method, "pending_service_fee")))
        .limit(1);
    const [serviceFeeRefundTx] = await tx
        .select({ id: schema_1.restaurantWalletTransactions.id })
        .from(schema_1.restaurantWalletTransactions)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.orderId, order.id), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.type, "adjustment"), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.method, "user_service_fee_refund")))
        .limit(1);
    const pendingFeeAlreadyCharged = Boolean(pendingServiceFeeTx) && !serviceFeeRefundTx;
    const settlementServiceFee = pendingFeeAlreadyCharged ? 0 : serviceFee;
    const wallet = await getOrCreateWallet(order.restaurantId, tx);
    const currentBalance = parseFloat(wallet.balance || "0");
    const currentCollectedCash = parseFloat(wallet.collectedCash || "0");
    const currentTotalEarning = parseFloat(wallet.totalEarning || "0");
    const currentTotalServiceFees = parseFloat(wallet.totalServiceFees || "0");
    const currentTotalCommission = parseFloat(wallet.totalCommission || "0");
    const currentTotalVisaCommission = parseFloat(wallet.totalVisaCommission || "0");
    const settlementState = buildSettlementCounterUpdate({
        paymentKind,
        currentBalance,
        currentCollectedCash,
        currentTotalEarning,
        currentTotalServiceFees,
        currentTotalCommission,
        currentTotalVisaCommission,
        subtotal,
        deliveryFee,
        settlementServiceFee,
        appCommission,
        discountAmount,
        orderVisaComm,
        totalAmount,
    });
    const newBalance = settlementState.balance;
    const newCollectedCash = settlementState.collectedCash;
    const newTotalEarning = settlementState.totalEarning;
    const newTotalServiceFees = settlementState.totalServiceFees;
    const newTotalCommission = settlementState.totalCommission;
    const newTotalVisaCommission = settlementState.totalVisaCommission;
    let transactionAmount = 0;
    let effectiveVisaComm = 0;
    let method = "cash";
    let transactionNote = "";
    if (paymentKind === "cash") {
        const appDues = roundMoney(appCommission + settlementServiceFee);
        transactionAmount = -appDues;
        method = "cash";
        transactionNote = `Delivered cash order #${order.dailyOrderNumber || order.orderNumber}; subtotal=${subtotal.toFixed(2)}; delivery=${deliveryFee.toFixed(2)}; commission=${appCommission.toFixed(2)}; serviceFee=${settlementServiceFee.toFixed(2)}; total=${totalAmount.toFixed(2)}; restaurant owes platform=${appDues.toFixed(2)}.`;
    }
    else if (paymentKind === "visa_system" || paymentKind === "user_wallet") {
        const restaurantCredit = roundMoney(subtotal + deliveryFee - appCommission - discountAmount - orderVisaComm);
        transactionAmount = restaurantCredit;
        effectiveVisaComm = orderVisaComm;
        method = (paymentKind === "user_wallet" ? "user_wallet" : "visa_system");
        transactionNote = `Delivered ${paymentKind === "user_wallet" ? "wallet" : "SYSTEM visa"} order #${order.dailyOrderNumber || order.orderNumber}; subtotal=${subtotal.toFixed(2)}; delivery=${deliveryFee.toFixed(2)}; commission=${appCommission.toFixed(2)}; serviceFee=${settlementServiceFee.toFixed(2)}; visaCommission=${orderVisaComm.toFixed(2)}; discount=${discountAmount.toFixed(2)}; credit=${restaurantCredit.toFixed(2)}.`;
    }
    else {
        const customDues = roundMoney(appCommission + settlementServiceFee);
        transactionAmount = -customDues;
        method = "visa_custom";
        transactionNote = `Delivered CUSTOM visa order #${order.dailyOrderNumber || order.orderNumber}; subtotal=${subtotal.toFixed(2)}; delivery=${deliveryFee.toFixed(2)}; commission=${appCommission.toFixed(2)}; serviceFee=${settlementServiceFee.toFixed(2)}; total=${totalAmount.toFixed(2)}; restaurant owes platform=${customDues.toFixed(2)}.`;
    }
    await tx
        .update(schema_1.restaurantWallets)
        .set({
        balance: newBalance.toFixed(2),
        collectedCash: newCollectedCash.toFixed(2),
        totalEarning: newTotalEarning.toFixed(2),
        totalServiceFees: newTotalServiceFees.toFixed(2),
        totalCommission: newTotalCommission.toFixed(2),
        totalVisaCommission: newTotalVisaCommission.toFixed(2),
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.id, wallet.id));
    if (paymentKind === "cash" || paymentKind === "visa_custom") {
        await checkAndApplyVisaSwitch(order.restaurantId, settlementServiceFee, tx);
    }
    if (paymentKind === "visa_system" || paymentKind === "user_wallet") {
        await notifyDebtSettledToSuperadmin(tx, order.restaurantId, currentBalance, newBalance);
    }
    const hasFees = appCommission !== 0 || settlementServiceFee !== 0 || effectiveVisaComm !== 0 || (paymentKind === "cash" && totalAmount !== 0);
    if (hasFees) {
        await tx.insert(schema_1.restaurantWalletTransactions).values({
            id: (0, uuid_1.v4)(),
            restaurantId: order.restaurantId,
            orderId: order.id,
            type: "order_payment",
            amount: transactionAmount.toFixed(2),
            balanceBefore: currentBalance.toFixed(2),
            balanceAfter: newBalance.toFixed(2),
            method,
            reference: order.orderNumber,
            serviceFee: settlementServiceFee.toFixed(2),
            commission: appCommission.toFixed(2),
            visaCommission: effectiveVisaComm.toFixed(2),
            orderAmount: totalAmount.toFixed(2),
            note: transactionNote,
            createdAt: new Date(),
        });
    }
}
async function notifyDebtSettledToSuperadmin(tx, restaurantId, previousBalance, nextBalance) {
    const [settings] = await tx
        .select({
        paymentGatewayType: schema_1.restaurantSettings.paymentGatewayType,
        visaSwitchApplied: schema_1.restaurantSettings.visaSwitchApplied,
    })
        .from(schema_1.restaurantSettings)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, restaurantId))
        .limit(1);
    if (!shouldNotifyDebtSettled(previousBalance, nextBalance, settings))
        return;
    await tx.insert(schema_1.notifications).values({
        id: (0, uuid_1.v4)(),
        recipientType: "superadmin",
        recipientId: "superadmin",
        title: "Debt settled",
        body: `Restaurant debt has been settled and it can be returned to CUSTOM.`,
        data: {
            type: "debt_settled",
            restaurantId,
            previousBalance: previousBalance.toFixed(2),
            nextBalance: nextBalance.toFixed(2),
        },
        isRead: false,
        createdAt: new Date(),
    });
}
/**
 * 3. Handle Cancelled Order
 * Checks if cancellation was by 'user' or 'restaurant'
 */
async function handleCancelledOrder(params) {
    const { orderId, cancelReasonType, tx } = params;
    const [order] = await tx
        .select()
        .from(schema_1.orders)
        .where((0, drizzle_orm_1.eq)(schema_1.orders.id, orderId))
        .for("update");
    if (!order)
        return;
    const [settledTx] = await tx
        .select()
        .from(schema_1.restaurantWalletTransactions)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.restaurantId, order.restaurantId), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.reference, order.orderNumber), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.type, "order_payment")))
        .limit(1);
    const [pendingServiceFeeTx] = await tx
        .select()
        .from(schema_1.restaurantWalletTransactions)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.orderId, order.id), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.type, "adjustment"), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.method, "pending_service_fee")))
        .limit(1);
    const [serviceFeeRefundTx] = await tx
        .select({ id: schema_1.restaurantWalletTransactions.id })
        .from(schema_1.restaurantWalletTransactions)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.orderId, order.id), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.type, "adjustment"), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.method, "user_service_fee_refund")))
        .limit(1);
    const subtotal = parseFloat(order.subtotal || "0");
    const deliveryFee = parseFloat(order.deliveryFee || "0");
    const serviceFee = parseFloat(order.serviceFee || "0");
    const appCommission = parseFloat(order.appCommission || "0");
    const totalAmount = parseFloat(order.totalAmount || "0");
    const pendingFeeAlreadyCharged = Boolean(pendingServiceFeeTx) && !serviceFeeRefundTx;
    const wallet = await getOrCreateWallet(order.restaurantId, tx);
    let currentBalance = parseFloat(wallet.balance || "0");
    let currentCollectedCash = parseFloat(wallet.collectedCash || "0");
    let currentTotalEarning = parseFloat(wallet.totalEarning || "0");
    let currentFees = parseFloat(wallet.totalServiceFees || "0");
    let currentCommission = parseFloat(wallet.totalCommission || "0");
    let currentVisaCommission = parseFloat(wallet.totalVisaCommission || "0");
    if (settledTx) {
        const { paymentKind } = await resolvePaymentTypeAndGateway({
            restaurantId: order.restaurantId,
            paymentMethodId: order.paymentMethod,
            paymentGateway: order.paymentGateway,
            orderGatewayType: order.paymentGatewayType,
            executor: tx,
        });
        const settledAmount = parseFloat(settledTx.amount || "0");
        const settledServiceFee = parseFloat(settledTx.serviceFee || "0");
        const settledCommission = parseFloat(settledTx.commission || "0");
        const settledVisaComm = parseFloat(settledTx.visaCommission || "0");
        const reversedCounters = buildCancellationCounterReversal({
            paymentKind,
            currentBalance,
            currentCollectedCash,
            currentTotalEarning,
            currentTotalServiceFees: currentFees,
            currentTotalCommission: currentCommission,
            currentTotalVisaCommission: currentVisaCommission,
            subtotal,
            deliveryFee,
            settledAmount,
            settledServiceFee,
            settledCommission,
            settledVisaComm,
            totalAmount,
        });
        currentBalance = reversedCounters.balance;
        currentCollectedCash = reversedCounters.collectedCash;
        currentTotalEarning = reversedCounters.totalEarning;
        currentFees = reversedCounters.totalServiceFees;
        currentCommission = reversedCounters.totalCommission;
        currentVisaCommission = reversedCounters.totalVisaCommission;
        const reversalMethod = (paymentKind === "user_wallet"
            ? "user_wallet"
            : paymentKind === "cash"
                ? "cash"
                : paymentKind === "visa_custom"
                    ? "visa_custom"
                    : "visa_system");
        await tx.insert(schema_1.restaurantWalletTransactions).values({
            id: (0, uuid_1.v4)(),
            restaurantId: order.restaurantId,
            orderId: order.id,
            type: "adjustment",
            amount: (-settledAmount).toFixed(2),
            balanceBefore: wallet.balance,
            balanceAfter: currentBalance.toFixed(2),
            method: reversalMethod,
            reference: order.orderNumber,
            serviceFee: (-settledServiceFee).toFixed(2),
            commission: (-settledCommission).toFixed(2),
            visaCommission: (-settledVisaComm).toFixed(2),
            orderAmount: totalAmount.toFixed(2),
            note: `Reversal for cancelled delivered order #${order.dailyOrderNumber || order.orderNumber}.`,
            createdAt: new Date(),
        });
        if (pendingFeeAlreadyCharged) {
            const balanceBeforePendingRefund = currentBalance;
            currentBalance = roundMoney(currentBalance + serviceFee);
            currentFees = roundMoney(currentFees - serviceFee);
            await tx.insert(schema_1.restaurantWalletTransactions).values({
                id: (0, uuid_1.v4)(),
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
                note: `Pending service fee refund for cancelled order #${order.dailyOrderNumber || order.orderNumber}.`,
                createdAt: new Date(),
            });
        }
        await tx.update(schema_1.restaurantWallets)
            .set({
            balance: currentBalance.toFixed(2),
            collectedCash: currentCollectedCash.toFixed(2),
            totalEarning: currentTotalEarning.toFixed(2),
            totalServiceFees: currentFees.toFixed(2),
            totalCommission: currentCommission.toFixed(2),
            totalVisaCommission: currentVisaCommission.toFixed(2),
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.id, wallet.id));
        if (paymentKind === "visa_system" && order.paymentStatus === "paid") {
            const refundFee = settledVisaComm > 0 ? settledVisaComm : parseFloat(order.visaCommission || "0");
            if (refundFee > 0) {
                await chargeGatewayFeeOnRefund(tx, order, refundFee, {
                    alreadyCounted: true,
                    note: `Gateway fee charged on refund for SYSTEM visa order #${order.dailyOrderNumber || order.orderNumber}.`,
                });
            }
        }
        if (paymentKind === "visa_system" && currentBalance < 0) {
            await checkAndApplyVisaSwitch(order.restaurantId, 0, tx);
        }
        return;
    }
    const { isCash, paymentKind } = await resolvePaymentTypeAndGateway({
        restaurantId: order.restaurantId,
        paymentMethodId: order.paymentMethod,
        paymentGateway: order.paymentGateway,
        orderGatewayType: order.paymentGatewayType,
        executor: tx,
    });
    const appDues = roundMoney(appCommission + (pendingFeeAlreadyCharged ? 0 : serviceFee));
    if (cancelReasonType === "restaurant" && (isCash || order.paymentStatus === "paid")) {
        const balanceBefore = currentBalance;
        const balanceAfter = roundMoney(currentBalance - appDues);
        await tx.update(schema_1.restaurantWallets)
            .set({
            balance: balanceAfter.toFixed(2),
            totalServiceFees: roundMoney(currentFees + (pendingFeeAlreadyCharged ? 0 : serviceFee)).toFixed(2),
            totalCommission: roundMoney(currentCommission + appCommission).toFixed(2),
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.id, wallet.id));
        await tx.insert(schema_1.restaurantWalletTransactions).values({
            id: (0, uuid_1.v4)(),
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
            note: `Restaurant cancellation penalty for order #${order.dailyOrderNumber || order.orderNumber}.`,
            createdAt: new Date(),
        });
        if (paymentKind === "visa_system" && order.paymentStatus === "paid") {
            const gatewayFee = parseFloat(order.visaCommission || "0");
            if (gatewayFee > 0) {
                await chargeGatewayFeeOnRefund(tx, order, gatewayFee, {
                    note: `Gateway fee charged on refund for SYSTEM visa order #${order.dailyOrderNumber || order.orderNumber}.`,
                });
            }
        }
        await checkAndApplyVisaSwitch(order.restaurantId, 0, tx);
        return;
    }
    if (paymentKind === "visa_system" && order.paymentStatus === "paid") {
        const gatewayFee = parseFloat(order.visaCommission || "0");
        if (gatewayFee > 0) {
            await chargeGatewayFeeOnRefund(tx, order, gatewayFee, {
                note: `Gateway fee charged on refund for SYSTEM visa order #${order.dailyOrderNumber || order.orderNumber}.`,
            });
        }
    }
    if (pendingFeeAlreadyCharged) {
        const balanceBefore = currentBalance;
        currentBalance = roundMoney(currentBalance + serviceFee);
        await tx.update(schema_1.restaurantWallets)
            .set({
            balance: currentBalance.toFixed(2),
            totalServiceFees: roundMoney(currentFees - serviceFee).toFixed(2),
            updatedAt: new Date(),
        })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.id, wallet.id));
        await tx.insert(schema_1.restaurantWalletTransactions).values({
            id: (0, uuid_1.v4)(),
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
            note: `Service fee refunded for cancelled order #${order.dailyOrderNumber || order.orderNumber}.`,
            createdAt: new Date(),
        });
    }
}
/**
 * 4. Get Wallet Details with Financial Summary (Who owes Whom)
 */
function buildWalletSummary(wallet) {
    const balance = parseFloat(wallet.balance || "0");
    const collectedCash = parseFloat(wallet.collectedCash || "0");
    const totalEarning = parseFloat(wallet.totalEarning || "0");
    const pendingWithdraw = parseFloat(wallet.pendingWithdraw || "0");
    const totalWithdrawn = parseFloat(wallet.totalWithdrawn || "0");
    let settlementStatus = "SETTLED";
    let explanationAr = "الحساب مصفّى بالكامل (لا توجد مديونيات معلقة).";
    let explanationEn = "Account is fully settled. No pending debt or receivables.";
    if (balance > 0) {
        settlementStatus = "SUPERADMIN_OWES_RESTAURANT";
        explanationAr = `للمطعم مستحقات لدى المنصة بقيمة ${balance.toFixed(2)} ج.م (أرباح صافية من مدفوعات إلكترونية عبر بوابة المنصة).`;
        explanationEn = `SuperAdmin owes restaurant ${balance.toFixed(2)} EGP (Net earnings from digital payments on System gateway).`;
    }
    else if (balance < 0) {
        settlementStatus = "RESTAURANT_OWES_SUPERADMIN";
        explanationAr = `على المطعم مستحقات واجبة السداد للمنصة بقيمة ${Math.abs(balance).toFixed(2)} ج.م (عمولات ورسوم خدمة لطلبات كاش أو بوابات دفع خاصة بالمطعم).`;
        explanationEn = `Restaurant owes SuperAdmin ${Math.abs(balance).toFixed(2)} EGP (App commission & service fees for cash or custom gateway orders).`;
    }
    const debt = Math.max(0, -balance);
    const canReturnToCustom = balance >= 0;
    return {
        id: wallet.id,
        restaurantId: wallet.restaurantId,
        balance: balance.toFixed(2),
        collectedCash: collectedCash.toFixed(2),
        pendingWithdraw: pendingWithdraw.toFixed(2),
        totalWithdrawn: totalWithdrawn.toFixed(2),
        totalEarning: totalEarning.toFixed(2),
        debt: debt.toFixed(2),
        canReturnToCustom,
        settlementSummary: {
            status: settlementStatus,
            amount: Math.abs(balance).toFixed(2),
            explanationAr,
            explanationEn,
        },
        updatedAt: wallet.updatedAt,
    };
}
