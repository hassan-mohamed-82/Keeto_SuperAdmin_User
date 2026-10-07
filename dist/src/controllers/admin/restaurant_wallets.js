"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordSubscription = exports.getWalletTransactions = exports.approveWithdrawal = exports.collectCashFromRestaurant = exports.getDetailedWallet = exports.getSystemGatewayRestaurants = exports.getRestaurantWallet = exports.getAllWallets = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
const restaurantWalletService_1 = require("../../services/restaurantWalletService");
/**
 * دالة مساعدة لجلب حركات المحفظة مربوطة ببيانات الأوردر (dailyOrderNumber, orderNumber, ...)
 * إذا كان نوع الحركة order_payment
 */
async function getWalletTransactionsWithOrderDetails(restaurantId, limit) {
    const query = connection_1.db
        .select({
        id: schema_1.restaurantWalletTransactions.id,
        restaurantId: schema_1.restaurantWalletTransactions.restaurantId,
        orderId: schema_1.restaurantWalletTransactions.orderId,
        type: schema_1.restaurantWalletTransactions.type,
        amount: schema_1.restaurantWalletTransactions.amount,
        balanceBefore: schema_1.restaurantWalletTransactions.balanceBefore,
        balanceAfter: schema_1.restaurantWalletTransactions.balanceAfter,
        method: schema_1.restaurantWalletTransactions.method,
        reference: schema_1.restaurantWalletTransactions.reference,
        serviceFee: schema_1.restaurantWalletTransactions.serviceFee,
        commission: schema_1.restaurantWalletTransactions.commission,
        visaCommission: schema_1.restaurantWalletTransactions.visaCommission,
        orderAmount: schema_1.restaurantWalletTransactions.orderAmount,
        note: schema_1.restaurantWalletTransactions.note,
        createdAt: schema_1.restaurantWalletTransactions.createdAt,
        order: {
            id: schema_1.orders.id,
            orderNumber: schema_1.orders.orderNumber,
            dailyOrderNumber: schema_1.orders.dailyOrderNumber,
            status: schema_1.orders.status,
            orderType: schema_1.orders.orderType,
            orderSource: schema_1.orders.orderSource,
            totalAmount: schema_1.orders.totalAmount,
            createdAt: schema_1.orders.createdAt,
        }
    })
        .from(schema_1.restaurantWalletTransactions)
        .leftJoin(schema_1.orders, (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.orderId, schema_1.orders.id), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.type, "order_payment"), (0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.reference, schema_1.orders.orderNumber))))
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.restaurantId, restaurantId))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.restaurantWalletTransactions.createdAt));
    const rows = limit ? await query.limit(limit) : await query;
    return rows.map(r => ({
        id: r.id,
        restaurantId: r.restaurantId,
        orderId: r.orderId || (r.order?.id ?? null),
        type: r.type,
        amount: r.amount,
        balanceBefore: r.balanceBefore,
        balanceAfter: r.balanceAfter,
        method: r.method,
        reference: r.reference,
        serviceFee: r.serviceFee,
        commission: r.commission,
        visaCommission: r.visaCommission,
        orderAmount: r.orderAmount,
        note: r.note,
        createdAt: r.createdAt,
        // إذا كان نوع الحركة order_payment يتم إرجاع تفاصيل الأوردر مع dailyOrderNumber
        order: (r.type === "order_payment" && r.order?.id) ? {
            id: r.order.id,
            orderNumber: r.order.orderNumber,
            dailyOrderNumber: r.order.dailyOrderNumber,
            status: r.order.status,
            orderType: r.order.orderType,
            orderSource: r.order.orderSource,
            totalAmount: r.order.totalAmount,
            createdAt: r.order.createdAt,
        } : null
    }));
}
// ==========================================
// 1. GET ALL WALLETS (Super Admin)
// ==========================================
const getAllWallets = async (req, res) => {
    const wallets = await connection_1.db
        .select({
        id: schema_1.restaurantWallets.id,
        balance: schema_1.restaurantWallets.balance,
        collectedCash: schema_1.restaurantWallets.collectedCash,
        pendingWithdraw: schema_1.restaurantWallets.pendingWithdraw,
        totalServiceFees: schema_1.restaurantWallets.totalServiceFees,
        totalCommission: schema_1.restaurantWallets.totalCommission,
        totalSubscriptions: schema_1.restaurantWallets.totalSubscriptions,
        restaurant: {
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
        }
    })
        .from(schema_1.restaurantWallets)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, schema_1.restaurants.id));
    const transformed = wallets.map((wallet) => {
        const balance = parseFloat(wallet.balance || "0");
        return {
            ...wallet,
            debt: Math.max(0, -balance).toFixed(2),
            canReturnToCustom: balance >= 0,
        };
    });
    return (0, response_1.SuccessResponse)(res, { data: transformed });
};
exports.getAllWallets = getAllWallets;
// ==========================================
// 2. GET SINGLE WALLET (Basic)
// ==========================================
const getRestaurantWallet = async (req, res, next) => {
    try {
        const restaurantId = req.params.restaurantId;
        const wallet = await connection_1.db
            .select()
            .from(schema_1.restaurantWallets)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId))
            .limit(1);
        if (!wallet[0]) {
            throw new NotFound_1.NotFound("Wallet not found");
        }
        const balance = parseFloat(wallet[0].balance || "0");
        const debt = Math.max(0, -balance);
        return (0, response_1.SuccessResponse)(res, {
            data: {
                ...wallet[0],
                debt: debt.toFixed(2),
                canReturnToCustom: balance >= 0,
            }
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getRestaurantWallet = getRestaurantWallet;
// ==========================================
// 2.5. GET RESTAURANTS USING SYSTEM GATEWAY
// ==========================================
const getSystemGatewayRestaurants = async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20);
    const offset = (page - 1) * limit;
    const [rows, totalResult] = await Promise.all([
        connection_1.db
            .select({
            restaurantId: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
            balance: schema_1.restaurantWallets.balance,
            gatewayAutoSwitchTriggeredAt: schema_1.restaurantSettings.gatewayAutoSwitchTriggeredAt,
        })
            .from(schema_1.restaurants)
            .innerJoin(schema_1.restaurantWallets, (0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restaurantWallets.restaurantId))
            .innerJoin(schema_1.restaurantSettings, (0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restaurantSettings.restaurantId))
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.paymentGatewayType, "SYSTEM"))
            .limit(limit)
            .offset(offset)
            .orderBy((0, drizzle_orm_1.desc)(schema_1.restaurants.createdAt)),
        connection_1.db
            .select({ count: (0, drizzle_orm_1.sql) `count(*)`.as("count") })
            .from(schema_1.restaurants)
            .innerJoin(schema_1.restaurantWallets, (0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restaurantWallets.restaurantId))
            .innerJoin(schema_1.restaurantSettings, (0, drizzle_orm_1.eq)(schema_1.restaurants.id, schema_1.restaurantSettings.restaurantId))
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.paymentGatewayType, "SYSTEM"))
    ]);
    const totalItems = Number(totalResult[0]?.count || 0);
    const data = rows.map((row) => {
        const balance = parseFloat(row.balance || "0");
        return {
            restaurantId: row.restaurantId,
            name: row.name,
            balance: row.balance,
            debt: Math.max(0, -balance).toFixed(2),
            canReturnToCustom: balance >= 0,
            gatewayAutoSwitchTriggeredAt: row.gatewayAutoSwitchTriggeredAt,
        };
    });
    return (0, response_1.SuccessResponse)(res, {
        data,
        pagination: {
            page,
            limit,
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
        },
    });
};
exports.getSystemGatewayRestaurants = getSystemGatewayRestaurants;
// ==========================================
// 3. GET DETAILED WALLET (تفصيل كامل)
// ==========================================
const getDetailedWallet = async (req, res) => {
    const restaurantId = req.params.restaurantId;
    // جلب بيانات المحفظة
    const wallet = await connection_1.db
        .select()
        .from(schema_1.restaurantWallets)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId))
        .limit(1);
    if (!wallet[0]) {
        throw new NotFound_1.NotFound("Wallet not found");
    }
    // جلب الخطط النشطة الخاصة بالمطعم (للاشتراكات الفعّالة)
    const activePlans = await connection_1.db
        .select({
        platformType: schema_1.restaurantBusinessPlans.platformType,
        isMonthlyActive: schema_1.restaurantBusinessPlans.isMonthlyActive,
        monthlyAmount: schema_1.restaurantBusinessPlans.monthlyAmount,
        isQuarterlyActive: schema_1.restaurantBusinessPlans.isQuarterlyActive,
        quarterlyAmount: schema_1.restaurantBusinessPlans.quarterlyAmount,
        isAnnuallyActive: schema_1.restaurantBusinessPlans.isAnnuallyActive,
        annuallyAmount: schema_1.restaurantBusinessPlans.annuallyAmount,
        commissionRate: schema_1.restaurantBusinessPlans.commissionRate,
        serviceFee: schema_1.restaurantBusinessPlans.serviceFee,
    })
        .from(schema_1.restaurantBusinessPlans)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantBusinessPlans.restaurantId, restaurantId));
    // تجميع الاشتراكات الفعالة حسب نوعها
    const activeSubscriptions = {
        monthly: activePlans
            .filter((p) => p.isMonthlyActive)
            .map((p) => ({
            platformType: p.platformType,
            amount: p.monthlyAmount,
        })),
        quarterly: activePlans
            .filter((p) => p.isQuarterlyActive)
            .map((p) => ({
            platformType: p.platformType,
            amount: p.quarterlyAmount,
        })),
        annually: activePlans
            .filter((p) => p.isAnnuallyActive)
            .map((p) => ({
            platformType: p.platformType,
            amount: p.annuallyAmount,
        })),
    };
    // حساب مجموع الاشتراكات الفعّالة (مبلغ يتم دفعه دوريًا)
    const totalActiveMonthly = activeSubscriptions.monthly.reduce((acc, s) => acc + parseFloat(s.amount || "0"), 0);
    const totalActiveQuarterly = activeSubscriptions.quarterly.reduce((acc, s) => acc + parseFloat(s.amount || "0"), 0);
    const totalActiveAnnually = activeSubscriptions.annually.reduce((acc, s) => acc + parseFloat(s.amount || "0"), 0);
    // إجمالي service fees وcommission من الخطط
    const totalPlanServiceFee = activePlans.reduce((acc, p) => acc + parseFloat(p.serviceFee || "0"), 0);
    const totalPlanCommissionRate = activePlans.reduce((acc, p) => acc + parseFloat(p.commissionRate || "0"), 0);
    // جلب آخر 10 transactions مع تفاصيل الأوردرات
    const recentTransactions = await getWalletTransactionsWithOrderDetails(restaurantId, 10);
    const w = wallet[0];
    const numericBalance = parseFloat(w.balance || "0");
    const accountStatus = numericBalance < 0
        ? "DUE_ON_RESTAURANT" // المطعم عليه فلوس للمنصة
        : numericBalance > 0
            ? "DUE_TO_RESTAURANT" // المطعم ليه فلوس عند المنصة
            : "SETTLED"; // الحساب متساوي وخالص
    const statusDescription = numericBalance < 0
        ? `المطعم عليه مديونية للمنصة بقيمة ${Math.abs(numericBalance).toFixed(2)} ج.م`
        : numericBalance > 0
            ? `المطعم ليه مستحقات عند المنصة بقيمة ${numericBalance.toFixed(2)} ج.م`
            : "الحساب متوازن وخالص (0.00 ج.م)";
    return (0, response_1.SuccessResponse)(res, {
        data: {
            // ==================
            // ملخص الحساب المالي المباشر
            // ==================
            accountSummary: {
                status: accountStatus,
                description: statusDescription,
                netAmount: Math.abs(numericBalance).toFixed(2),
                balance: w.balance,
                collectedCash: w.collectedCash,
                totalEarning: w.totalEarning,
                debt: Math.max(0, -numericBalance).toFixed(2),
                canReturnToCustom: numericBalance >= 0,
            },
            // ==================
            // الرسوم والعمولات المتراكمة (مسجّلة في المحفظة)
            // ==================
            fees: {
                totalServiceFeesRecorded: w.totalServiceFees, // إجمالي service fees المسجلة
                totalCommissionRecorded: w.totalCommission, // إجمالي الكوميشن المسجل
                totalVisaCommissionRecorded: w.totalVisaCommission || "0.00", // إجمالي عمولة الفيزا المسجلة
                totalSubscriptionsRecorded: w.totalSubscriptions, // إجمالي الاشتراكات المسجلة
                lastMonthlySubscription: w.lastMonthlySubscription,
                lastQuarterlySubscription: w.lastQuarterlySubscription,
                lastAnnuallySubscription: w.lastAnnuallySubscription,
            },
            // ==================
            // الاشتراكات الحالية الفعّالة (من الخطط النشطة)
            // ==================
            activeSubscriptions: {
                monthly: {
                    plans: activeSubscriptions.monthly,
                    totalPerCycle: totalActiveMonthly.toFixed(2),
                },
                quarterly: {
                    plans: activeSubscriptions.quarterly,
                    totalPerCycle: totalActiveQuarterly.toFixed(2),
                },
                annually: {
                    plans: activeSubscriptions.annually,
                    totalPerCycle: totalActiveAnnually.toFixed(2),
                },
            },
            // ==================
            // الرسوم الجارية من الخطط
            // ==================
            currentPlanFees: {
                totalServiceFeePerOrder: totalPlanServiceFee.toFixed(2),
                totalCommissionRatePercent: totalPlanCommissionRate.toFixed(2),
            },
            // ==================
            // آخر التعاملات
            // ==================
            recentTransactions,
        }
    });
};
exports.getDetailedWallet = getDetailedWallet;
// ==========================================
// 4. COLLECT CASH (Super Admin)
// ==========================================
const collectCashFromRestaurant = async (req, res) => {
    // 👇 التعديل هنا
    const restaurantId = req.params.restaurantId || req.params.id;
    const { amount } = req.body;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Restaurant ID is required");
    const collectAmount = parseFloat(amount);
    if (!collectAmount || collectAmount <= 0)
        throw new BadRequest_1.BadRequest("Invalid amount");
    const wallet = await connection_1.db
        .select()
        .from(schema_1.restaurantWallets)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId))
        .limit(1);
    if (!wallet[0])
        throw new NotFound_1.NotFound("Wallet not found");
    const currentCash = parseFloat(wallet[0].collectedCash || "0");
    const currentBalance = parseFloat(wallet[0].balance || "0");
    if (collectAmount > currentCash) {
        throw new BadRequest_1.BadRequest("Amount exceeds collected cash in the restaurant's drawer");
    }
    const newCollectedCash = currentCash - collectAmount;
    // 👇 السر هنا: لما المطعم بيدفع كاش للمنصة، المديونية اللي عليه بتقل (الرصيد بيزيد ناحية الصفر أو الموجب)
    const newBalance = currentBalance + collectAmount;
    await connection_1.db.transaction(async (tx) => {
        // update wallet
        await tx
            .update(schema_1.restaurantWallets)
            .set({
            collectedCash: newCollectedCash.toFixed(2),
            balance: newBalance.toFixed(2) // 👈 تحديث الرصيد
        })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId));
        // log transaction
        await tx.insert(schema_1.restaurantWalletTransactions).values({
            id: (0, uuid_1.v4)(),
            restaurantId,
            type: "cash_collection",
            amount: collectAmount.toFixed(2),
            balanceBefore: currentBalance.toFixed(2),
            balanceAfter: newBalance.toFixed(2),
            method: "cash",
            note: "Super admin collected cash (Debt settled)",
        });
    });
    return (0, response_1.SuccessResponse)(res, { message: "Cash collected and balance settled successfully" });
};
exports.collectCashFromRestaurant = collectCashFromRestaurant;
// ==========================================
// 5. APPROVE WITHDRAWAL
// ==========================================
const approveWithdrawal = async (req, res) => {
    // 👇 التعديل هنا
    const restaurantId = req.params.restaurantId || req.params.id;
    const { amount } = req.body;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Restaurant ID is required");
    const approveAmount = parseFloat(amount);
    if (!approveAmount || approveAmount <= 0)
        throw new BadRequest_1.BadRequest("Invalid amount");
    const wallet = await connection_1.db
        .select()
        .from(schema_1.restaurantWallets)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId))
        .limit(1);
    if (!wallet[0])
        throw new NotFound_1.NotFound("Wallet not found");
    const pending = parseFloat(wallet[0].pendingWithdraw || "0");
    const withdrawn = parseFloat(wallet[0].totalWithdrawn || "0");
    if (approveAmount > pending) {
        throw new BadRequest_1.BadRequest("Amount exceeds pending withdraw");
    }
    await connection_1.db.transaction(async (tx) => {
        await tx.update(schema_1.restaurantWallets)
            .set({
            pendingWithdraw: (pending - approveAmount).toFixed(2),
            totalWithdrawn: (withdrawn + approveAmount).toFixed(2)
        })
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId));
        await tx.insert(schema_1.restaurantWalletTransactions).values({
            id: (0, uuid_1.v4)(),
            restaurantId,
            type: "withdraw",
            amount: approveAmount.toFixed(2),
            balanceBefore: pending.toFixed(2),
            balanceAfter: (pending - approveAmount).toFixed(2),
            method: "bank",
            note: "Withdrawal approved by admin",
        });
    });
    return (0, response_1.SuccessResponse)(res, { message: "Withdrawal approved successfully" });
};
exports.approveWithdrawal = approveWithdrawal;
// ==========================================
// 6. WALLET TRANSACTIONS HISTORY
// ==========================================
const getWalletTransactions = async (req, res) => {
    // 👇 التعديل هنا
    const restaurantId = req.params.restaurantId || req.params.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Restaurant ID is required");
    const data = await getWalletTransactionsWithOrderDetails(restaurantId);
    return (0, response_1.SuccessResponse)(res, { data });
};
exports.getWalletTransactions = getWalletTransactions;
// ==========================================
// 7. RECORD SUBSCRIPTION (تسجيل اشتراك دوري في المحفظة)
// يُستخدم يدويًا أو تلقائيًا لتسجيل الاشتراك الدوري في محفظة المطعم
// ==========================================
const recordSubscription = async (req, res) => {
    const { restaurantId, subscriptionType, amount, subscriptionDate, note } = req.body;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Restaurant ID is required");
    if (!subscriptionType || !["monthly", "quarterly", "annually"].includes(subscriptionType)) {
        throw new BadRequest_1.BadRequest("subscriptionType must be 'monthly', 'quarterly', or 'annually'");
    }
    const subAmount = parseFloat(amount);
    if (!subAmount || subAmount <= 0)
        throw new BadRequest_1.BadRequest("Invalid subscription amount");
    // تاريخ بداية/تسجيل الاشتراك: الافتراضي هو اليوم أو التاريخ المحدد
    const effectiveDate = subscriptionDate || new Date().toISOString().split("T")[0];
    const wallet = await connection_1.db
        .select()
        .from(schema_1.restaurantWallets)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId))
        .limit(1);
    if (!wallet[0])
        throw new NotFound_1.NotFound("Wallet not found");
    const currentBalance = parseFloat(wallet[0].balance || "0");
    const currentTotalSubs = parseFloat(wallet[0].totalSubscriptions || "0");
    // 🟢 الاشتراك يخصم من الرصيد ويزيد مديونية المطعم
    const newBalance = Math.round((currentBalance - subAmount + Number.EPSILON) * 100) / 100;
    const newTotalSubs = Math.round((currentTotalSubs + subAmount + Number.EPSILON) * 100) / 100;
    const walletUpdateFields = {
        balance: newBalance.toFixed(2),
        totalSubscriptions: newTotalSubs.toFixed(2),
    };
    if (subscriptionType === "monthly") {
        walletUpdateFields.lastMonthlySubscription = subAmount.toFixed(2);
    }
    else if (subscriptionType === "quarterly") {
        walletUpdateFields.lastQuarterlySubscription = subAmount.toFixed(2);
    }
    else if (subscriptionType === "annually") {
        walletUpdateFields.lastAnnuallySubscription = subAmount.toFixed(2);
    }
    await connection_1.db.transaction(async (tx) => {
        await tx.update(schema_1.restaurantWallets)
            .set(walletUpdateFields)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId));
        await tx.insert(schema_1.restaurantWalletTransactions).values({
            id: (0, uuid_1.v4)(),
            restaurantId,
            type: "subscription",
            amount: `-${subAmount.toFixed(2)}`,
            balanceBefore: currentBalance.toFixed(2),
            balanceAfter: newBalance.toFixed(2),
            method: "system",
            note: note || `${subscriptionType} subscription charged to wallet (Date: ${effectiveDate})`,
            createdAt: new Date(),
        });
        await (0, restaurantWalletService_1.checkAndApplyVisaSwitch)(restaurantId, 0, tx);
    });
    return (0, response_1.SuccessResponse)(res, {
        message: `${subscriptionType} subscription charged successfully to wallet`,
        data: {
            deductedAmount: subAmount.toFixed(2),
            balanceBefore: currentBalance.toFixed(2),
            balanceAfter: newBalance.toFixed(2),
            subscriptionDate: effectiveDate
        }
    });
};
exports.recordSubscription = recordSubscription;
