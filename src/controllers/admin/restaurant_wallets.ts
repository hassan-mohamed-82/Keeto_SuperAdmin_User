// controllers/admin/restaurantWallet.controller.ts
import { Request, Response,NextFunction } from "express";
import { db } from "../../models/connection";
import { restaurantWallets, restaurantWalletTransactions, restaurants, restaurantBusinessPlans, orders, restaurantSettings } from "../../models/schema";
import { eq, desc, sum, sql, or, and } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";
import { checkAndApplyVisaSwitch } from "../../services/restaurantWalletService";

/**
 * دالة مساعدة لجلب حركات المحفظة مربوطة ببيانات الأوردر (dailyOrderNumber, orderNumber, ...)
 * إذا كان نوع الحركة order_payment
 */
async function getWalletTransactionsWithOrderDetails(restaurantId: string, limit?: number) {
    const query = db
        .select({
            id: restaurantWalletTransactions.id,
            restaurantId: restaurantWalletTransactions.restaurantId,
            orderId: restaurantWalletTransactions.orderId,
            type: restaurantWalletTransactions.type,
            amount: restaurantWalletTransactions.amount,
            balanceBefore: restaurantWalletTransactions.balanceBefore,
            balanceAfter: restaurantWalletTransactions.balanceAfter,
            method: restaurantWalletTransactions.method,
            reference: restaurantWalletTransactions.reference,
            serviceFee: restaurantWalletTransactions.serviceFee,
            commission: restaurantWalletTransactions.commission,
            visaCommission: restaurantWalletTransactions.visaCommission,
            orderAmount: restaurantWalletTransactions.orderAmount,
            note: restaurantWalletTransactions.note,
            createdAt: restaurantWalletTransactions.createdAt,
            order: {
                id: orders.id,
                orderNumber: orders.orderNumber,
                dailyOrderNumber: orders.dailyOrderNumber,
                status: orders.status,
                orderType: orders.orderType,
                orderSource: orders.orderSource,
                totalAmount: orders.totalAmount,
                createdAt: orders.createdAt,
            }
        })
        .from(restaurantWalletTransactions)
        .leftJoin(orders, or(
            eq(restaurantWalletTransactions.orderId, orders.id),
            and(
                eq(restaurantWalletTransactions.type, "order_payment"),
                eq(restaurantWalletTransactions.reference, orders.orderNumber)
            )
        ))
        .where(eq(restaurantWalletTransactions.restaurantId, restaurantId))
        .orderBy(desc(restaurantWalletTransactions.createdAt));

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
export const getAllWallets = async (req: Request, res: Response) => {
    const wallets = await db
        .select({
            id: restaurantWallets.id,
            balance: restaurantWallets.balance,
            collectedCash: restaurantWallets.collectedCash,
            pendingWithdraw: restaurantWallets.pendingWithdraw,
            totalServiceFees: restaurantWallets.totalServiceFees,
            totalCommission: restaurantWallets.totalCommission,
            totalSubscriptions: restaurantWallets.totalSubscriptions,
            restaurant: {
                id: restaurants.id,
                name: restaurants.name,
            }
        })
        .from(restaurantWallets)
        .leftJoin(restaurants, eq(restaurantWallets.restaurantId, restaurants.id));

    const transformed = wallets.map((wallet) => {
        const balance = parseFloat(wallet.balance as string || "0");
        return {
            ...wallet,
            debt: Math.max(0, -balance).toFixed(2),
            canReturnToCustom: balance >= 0,
        };
    });

    return SuccessResponse(res, { data: transformed });
};

// ==========================================
// 2. GET SINGLE WALLET (Basic)
// ==========================================
export const getRestaurantWallet = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const restaurantId = req.params.restaurantId;

        const wallet = await db
            .select()
            .from(restaurantWallets)
            .where(eq(restaurantWallets.restaurantId, restaurantId))
            .limit(1);

        if (!wallet[0]) {
            throw new NotFound("Wallet not found"); 
        }

        const balance = parseFloat(wallet[0].balance as string || "0");
        const debt = Math.max(0, -balance);
        return SuccessResponse(res, {
            data: {
                ...wallet[0],
                debt: debt.toFixed(2),
                canReturnToCustom: balance >= 0,
            }
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// 2.5. GET RESTAURANTS USING SYSTEM GATEWAY
// ==========================================
export const getSystemGatewayRestaurants = async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.max(1, parseInt(String(req.query.limit || "20"), 10) || 20);
    const offset = (page - 1) * limit;

    const [rows, totalResult] = await Promise.all([
        db
            .select({
                restaurantId: restaurants.id,
                name: restaurants.name,
                balance: restaurantWallets.balance,
                gatewayAutoSwitchTriggeredAt: restaurantSettings.gatewayAutoSwitchTriggeredAt,
            })
            .from(restaurants)
            .innerJoin(restaurantWallets, eq(restaurants.id, restaurantWallets.restaurantId))
            .innerJoin(restaurantSettings, eq(restaurants.id, restaurantSettings.restaurantId))
            .where(eq(restaurantSettings.paymentGatewayType, "SYSTEM"))
            .limit(limit)
            .offset(offset)
            .orderBy(desc(restaurants.createdAt)),
        db
            .select({ count: sql<number>`count(*)`.as("count") })
            .from(restaurants)
            .innerJoin(restaurantWallets, eq(restaurants.id, restaurantWallets.restaurantId))
            .innerJoin(restaurantSettings, eq(restaurants.id, restaurantSettings.restaurantId))
            .where(eq(restaurantSettings.paymentGatewayType, "SYSTEM"))
    ]);

    const totalItems = Number(totalResult[0]?.count || 0);
    const data = rows.map((row) => {
        const balance = parseFloat(row.balance as string || "0");
        return {
            restaurantId: row.restaurantId,
            name: row.name,
            balance: row.balance,
            debt: Math.max(0, -balance).toFixed(2),
            canReturnToCustom: balance >= 0,
            gatewayAutoSwitchTriggeredAt: row.gatewayAutoSwitchTriggeredAt,
        };
    });

    return SuccessResponse(res, {
        data,
        pagination: {
            page,
            limit,
            totalItems,
            totalPages: Math.ceil(totalItems / limit),
        },
    });
};

// ==========================================
// 3. GET DETAILED WALLET (تفصيل كامل)
// ==========================================
export const getDetailedWallet = async (req: Request, res: Response) => {
    const restaurantId = req.params.restaurantId;

    // جلب بيانات المحفظة
    const wallet = await db
        .select()
        .from(restaurantWallets)
        .where(eq(restaurantWallets.restaurantId, restaurantId))
        .limit(1);

    if (!wallet[0]) {
        throw new NotFound("Wallet not found");
    }

    // جلب الخطط النشطة الخاصة بالمطعم (للاشتراكات الفعّالة)
    const activePlans = await db
        .select({
            platformType: restaurantBusinessPlans.platformType,
            isMonthlyActive: restaurantBusinessPlans.isMonthlyActive,
            monthlyAmount: restaurantBusinessPlans.monthlyAmount,
            isQuarterlyActive: restaurantBusinessPlans.isQuarterlyActive,
            quarterlyAmount: restaurantBusinessPlans.quarterlyAmount,
            isAnnuallyActive: restaurantBusinessPlans.isAnnuallyActive,
            annuallyAmount: restaurantBusinessPlans.annuallyAmount,
            commissionRate: restaurantBusinessPlans.commissionRate,
            serviceFee: restaurantBusinessPlans.serviceFee,
        })
        .from(restaurantBusinessPlans)
        .where(eq(restaurantBusinessPlans.restaurantId, restaurantId));

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
    const totalActiveMonthly = activeSubscriptions.monthly.reduce(
        (acc, s) => acc + parseFloat(s.amount as string || "0"), 0
    );
    const totalActiveQuarterly = activeSubscriptions.quarterly.reduce(
        (acc, s) => acc + parseFloat(s.amount as string || "0"), 0
    );
    const totalActiveAnnually = activeSubscriptions.annually.reduce(
        (acc, s) => acc + parseFloat(s.amount as string || "0"), 0
    );

    // إجمالي service fees وcommission من الخطط
    const totalPlanServiceFee = activePlans.reduce(
        (acc, p) => acc + parseFloat(p.serviceFee as string || "0"), 0
    );
    const totalPlanCommissionRate = activePlans.reduce(
        (acc, p) => acc + parseFloat(p.commissionRate as string || "0"), 0
    );

    // جلب آخر 10 transactions مع تفاصيل الأوردرات
    const recentTransactions = await getWalletTransactionsWithOrderDetails(restaurantId, 10);

    const w = wallet[0];
    const numericBalance = parseFloat(w.balance as string || "0");
    const accountStatus = numericBalance < 0 
        ? "DUE_ON_RESTAURANT"   // المطعم عليه فلوس للمنصة
        : numericBalance > 0 
            ? "DUE_TO_RESTAURANT"  // المطعم ليه فلوس عند المنصة
            : "SETTLED";           // الحساب متساوي وخالص

    const statusDescription = numericBalance < 0
        ? `المطعم عليه مديونية للمنصة بقيمة ${Math.abs(numericBalance).toFixed(2)} ج.م`
        : numericBalance > 0
            ? `المطعم ليه مستحقات عند المنصة بقيمة ${numericBalance.toFixed(2)} ج.م`
            : "الحساب متوازن وخالص (0.00 ج.م)";
    
    return SuccessResponse(res, {
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
                totalServiceFeesRecorded: w.totalServiceFees,   // إجمالي service fees المسجلة
                totalCommissionRecorded: w.totalCommission,      // إجمالي الكوميشن المسجل
                totalVisaCommissionRecorded: (w as any).totalVisaCommission || "0.00", // إجمالي عمولة الفيزا المسجلة
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

// ==========================================
// 4. COLLECT CASH (Super Admin)
// ==========================================
export const collectCashFromRestaurant = async (req: Request, res: Response) => {
    // 👇 التعديل هنا
    const restaurantId = req.params.restaurantId || req.params.id;
    const { amount } = req.body;

    if (!restaurantId) throw new BadRequest("Restaurant ID is required");

    const collectAmount = parseFloat(amount);
    if (!collectAmount || collectAmount <= 0) throw new BadRequest("Invalid amount");

    const wallet = await db
        .select()
        .from(restaurantWallets)
        .where(eq(restaurantWallets.restaurantId, restaurantId))
        .limit(1);

    if (!wallet[0]) throw new NotFound("Wallet not found");

    const currentCash = parseFloat(wallet[0].collectedCash as string || "0");
    const currentBalance = parseFloat(wallet[0].balance as string || "0");

    if (collectAmount > currentCash) {
        throw new BadRequest("Amount exceeds collected cash in the restaurant's drawer");
    }

    const newCollectedCash = currentCash - collectAmount;
    
    // 👇 السر هنا: لما المطعم بيدفع كاش للمنصة، المديونية اللي عليه بتقل (الرصيد بيزيد ناحية الصفر أو الموجب)
    const newBalance = currentBalance + collectAmount;

    await db.transaction(async (tx) => {

        // update wallet
        await tx
            .update(restaurantWallets)
            .set({ 
                collectedCash: newCollectedCash.toFixed(2),
                balance: newBalance.toFixed(2) // 👈 تحديث الرصيد
            })
            .where(eq(restaurantWallets.restaurantId, restaurantId));

        // log transaction
        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId,
            type: "cash_collection",
            amount: collectAmount.toFixed(2),
            balanceBefore: currentBalance.toFixed(2),
            balanceAfter: newBalance.toFixed(2),
            method: "cash",
            note: "Super admin collected cash (Debt settled)",
        });
    });

    return SuccessResponse(res, { message: "Cash collected and balance settled successfully" });
};

// ==========================================
// 5. APPROVE WITHDRAWAL
// ==========================================
export const approveWithdrawal = async (req: Request, res: Response) => {
    // 👇 التعديل هنا
    const restaurantId = req.params.restaurantId || req.params.id;
    const { amount } = req.body;

    if (!restaurantId) throw new BadRequest("Restaurant ID is required");

    const approveAmount = parseFloat(amount);
    if (!approveAmount || approveAmount <= 0) throw new BadRequest("Invalid amount");

    const wallet = await db
        .select()
        .from(restaurantWallets)
        .where(eq(restaurantWallets.restaurantId, restaurantId))
        .limit(1);

    if (!wallet[0]) throw new NotFound("Wallet not found");

    const pending = parseFloat(wallet[0].pendingWithdraw as string || "0");
    const withdrawn = parseFloat(wallet[0].totalWithdrawn as string || "0");

    if (approveAmount > pending) {
        throw new BadRequest("Amount exceeds pending withdraw");
    }

    await db.transaction(async (tx) => {

        await tx.update(restaurantWallets)
            .set({
                pendingWithdraw: (pending - approveAmount).toFixed(2),
                totalWithdrawn: (withdrawn + approveAmount).toFixed(2)
            })
            .where(eq(restaurantWallets.restaurantId, restaurantId));

        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId,
            type: "withdraw",
            amount: approveAmount.toFixed(2),
            balanceBefore: pending.toFixed(2), 
            balanceAfter: (pending - approveAmount).toFixed(2), 
            method: "bank",
            note: "Withdrawal approved by admin",
        });
    });

    return SuccessResponse(res, { message: "Withdrawal approved successfully" });
};

// ==========================================
// 6. WALLET TRANSACTIONS HISTORY
// ==========================================
export const getWalletTransactions = async (req: Request, res: Response) => {
    // 👇 التعديل هنا
    const restaurantId = req.params.restaurantId || req.params.id;

    if (!restaurantId) throw new BadRequest("Restaurant ID is required");

    const data = await getWalletTransactionsWithOrderDetails(restaurantId);

    return SuccessResponse(res, { data });
};

// ==========================================
// 7. RECORD SUBSCRIPTION (تسجيل اشتراك دوري في المحفظة)
// يُستخدم يدويًا أو تلقائيًا لتسجيل الاشتراك الدوري في محفظة المطعم
// ==========================================
export const recordSubscription = async (req: Request, res: Response) => {
    const { restaurantId, subscriptionType, amount, subscriptionDate, note } = req.body;

    if (!restaurantId) throw new BadRequest("Restaurant ID is required");
    if (!subscriptionType || !["monthly", "quarterly", "annually"].includes(subscriptionType)) {
        throw new BadRequest("subscriptionType must be 'monthly', 'quarterly', or 'annually'");
    }

    const subAmount = parseFloat(amount);
    if (!subAmount || subAmount <= 0) throw new BadRequest("Invalid subscription amount");

    // تاريخ بداية/تسجيل الاشتراك: الافتراضي هو اليوم أو التاريخ المحدد
    const effectiveDate = subscriptionDate || new Date().toISOString().split("T")[0];

    const wallet = await db
        .select()
        .from(restaurantWallets)
        .where(eq(restaurantWallets.restaurantId, restaurantId))
        .limit(1);

    if (!wallet[0]) throw new NotFound("Wallet not found");

    const currentBalance = parseFloat(wallet[0].balance as string || "0");
    const currentTotalSubs = parseFloat(wallet[0].totalSubscriptions as string || "0");

    // 🟢 الاشتراك يخصم من الرصيد ويزيد مديونية المطعم
    const newBalance = Math.round((currentBalance - subAmount + Number.EPSILON) * 100) / 100;
    const newTotalSubs = Math.round((currentTotalSubs + subAmount + Number.EPSILON) * 100) / 100;

    const walletUpdateFields: Record<string, string> = {
        balance: newBalance.toFixed(2),
        totalSubscriptions: newTotalSubs.toFixed(2),
    };

    if (subscriptionType === "monthly") {
        walletUpdateFields.lastMonthlySubscription = subAmount.toFixed(2);
    } else if (subscriptionType === "quarterly") {
        walletUpdateFields.lastQuarterlySubscription = subAmount.toFixed(2);
    } else if (subscriptionType === "annually") {
        walletUpdateFields.lastAnnuallySubscription = subAmount.toFixed(2);
    }

    await db.transaction(async (tx) => {
        await tx.update(restaurantWallets)
            .set(walletUpdateFields)
            .where(eq(restaurantWallets.restaurantId, restaurantId));

        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId,
            type: "subscription",
            amount: `-${subAmount.toFixed(2)}`,
            balanceBefore: currentBalance.toFixed(2),
            balanceAfter: newBalance.toFixed(2),
            method: "system",
            note: note || `${subscriptionType} subscription charged to wallet (Date: ${effectiveDate})`,
            createdAt: new Date(),
        });

        await checkAndApplyVisaSwitch(restaurantId, 0, tx);
    });

    return SuccessResponse(res, { 
        message: `${subscriptionType} subscription charged successfully to wallet`,
        data: {
            deductedAmount: subAmount.toFixed(2),
            balanceBefore: currentBalance.toFixed(2),
            balanceAfter: newBalance.toFixed(2),
            subscriptionDate: effectiveDate
        }
    });
};
