"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWalletHistory = exports.convertLoyaltyPoints = exports.addFundToWallet = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const uuid_1 = require("uuid");
const Errors_1 = require("../../Errors");
// =====================================================
// 1. شحن المحفظة (Add Fund to Wallet)
// =====================================================
const addFundToWallet = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { amount, paymentMethodId, receiptImage } = req.body;
    const depositAmount = Number(amount);
    const [method] = await connection_1.db
        .select()
        .from(schema_1.paymentMethods)
        .where((0, drizzle_orm_1.eq)(schema_1.paymentMethods.id, paymentMethodId))
        .limit(1);
    if (!method)
        throw new BadRequest_1.BadRequest("Invalid payment method");
    const isManual = !!receiptImage;
    await connection_1.db.transaction(async (tx) => {
        let [wallet] = await tx
            .select()
            .from(schema_1.userWallets)
            .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId))
            .limit(1);
        if (!wallet) {
            await tx.insert(schema_1.userWallets).values({
                id: (0, uuid_1.v4)(),
                userId: userId,
                balance: "0.00",
                loyaltyPoints: 0,
            });
            [wallet] = await tx
                .select()
                .from(schema_1.userWallets)
                .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId))
                .limit(1);
        }
        const before = Number(wallet.balance || "0");
        // 🟡 MANUAL (pending)
        if (isManual) {
            await tx.insert(schema_1.userWalletTransactions).values({
                id: (0, uuid_1.v4)(),
                userId: userId,
                paymentMethodId,
                type: "credit",
                transactionType: "manual_deposit",
                amount: depositAmount.toString(),
                balanceBefore: before.toString(),
                receiptImage,
                status: "pending",
                reference: "Waiting Admin Approval"
            });
            return;
        }
        // 🟢 AUTOMATIC
        await tx.insert(schema_1.userWalletTransactions).values({
            id: (0, uuid_1.v4)(),
            userId: userId,
            paymentMethodId,
            type: "credit",
            transactionType: "add_fund",
            amount: depositAmount.toString(),
            balanceBefore: before.toString(),
            status: "approved",
            reference: method.name
        });
        await tx.update(schema_1.userWallets)
            .set({ balance: (before + depositAmount).toString() })
            .where((0, drizzle_orm_1.eq)(schema_1.userWallets.id, wallet.id));
    });
    return (0, response_1.SuccessResponse)(res, {
        message: isManual
            ? "Waiting for admin approval"
            : "Wallet updated successfully"
    });
};
exports.addFundToWallet = addFundToWallet;
// =====================================================
// 2. تحويل النقاط لفلوس (Convert Loyalty Points)
// =====================================================
const convertLoyaltyPoints = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { pointsToConvert } = req.body;
    const points = parseInt(pointsToConvert);
    // افتراض: كل 100 نقطة = 10 جنيه
    const conversionRate = 0.1;
    const amountToAdd = points * conversionRate;
    await connection_1.db.transaction(async (tx) => {
        const [wallet] = await tx.select().from(schema_1.userWallets).where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId)).limit(1);
        const currentLoyaltyPoints = wallet?.loyaltyPoints || 0;
        if (!wallet || currentLoyaltyPoints < points) {
            throw new BadRequest_1.BadRequest("نقاطك لا تكفي لإتمام التحويل");
        }
        const currentBalance = parseFloat(wallet.balance || "0");
        // تسجيل الحركة
        await tx.insert(schema_1.userWalletTransactions).values({
            id: (0, uuid_1.v4)(),
            userId: userId,
            type: "credit",
            transactionType: "converted_loyalty",
            amount: amountToAdd.toString(),
            balanceBefore: currentBalance.toString(),
            reference: `Converted ${points} points`
            // Note: paymentMethodId is omitted as this is an internal conversion
        });
        // تحديث المحفظة (خصم النقط وإضافة الفلوس)
        await tx.update(schema_1.userWallets)
            .set({
            loyaltyPoints: currentLoyaltyPoints - points,
            balance: (currentBalance + amountToAdd).toString()
        })
            .where((0, drizzle_orm_1.eq)(schema_1.userWallets.id, wallet.id));
    });
    return (0, response_1.SuccessResponse)(res, { message: "تم تحويل النقاط لرصيد بنجاح" });
};
exports.convertLoyaltyPoints = convertLoyaltyPoints;
// =====================================================
// 3. عرض سجل المحفظة مع الفلتر (Wallet History Filter)
// =====================================================
const getWalletHistory = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { filter } = req.query;
    let conditions = (0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.userId, userId);
    if (filter === "orders") {
        conditions = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.transactionType, "order_payment"));
    }
    else if (filter === "deposit") {
        conditions = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.transactionType, "add_fund"));
    }
    else if (filter === "manual_pending") {
        conditions = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.status, "pending"));
    }
    else if (filter === "manual_approved") {
        conditions = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.status, "approved"));
    }
    else if (filter === "manual_rejected") {
        conditions = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userWalletTransactions.status, "rejected"));
    }
    const history = await connection_1.db
        .select({
        id: schema_1.userWalletTransactions.id,
        amount: schema_1.userWalletTransactions.amount,
        type: schema_1.userWalletTransactions.type,
        transactionType: schema_1.userWalletTransactions.transactionType,
        status: schema_1.userWalletTransactions.status,
        balanceBefore: schema_1.userWalletTransactions.balanceBefore,
        reference: schema_1.userWalletTransactions.reference,
        receiptImage: schema_1.userWalletTransactions.receiptImage,
        createdAt: schema_1.userWalletTransactions.createdAt,
        paymentMethodId: schema_1.userWalletTransactions.paymentMethodId,
    })
        .from(schema_1.userWalletTransactions)
        .where(conditions)
        .orderBy((0, drizzle_orm_1.desc)(schema_1.userWalletTransactions.createdAt));
    return (0, response_1.SuccessResponse)(res, { data: history });
};
exports.getWalletHistory = getWalletHistory;
