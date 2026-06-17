"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWalletTransactions = exports.approveWithdrawal = exports.collectCashFromRestaurant = exports.getRestaurantWallet = exports.getAllWallets = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const response_1 = require("../../utils/response");
const BadRequest_1 = require("../../Errors/BadRequest");
const NotFound_1 = require("../../Errors/NotFound");
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
        restaurant: {
            id: schema_1.restaurants.id,
            name: schema_1.restaurants.name,
        }
    })
        .from(schema_1.restaurantWallets)
        .leftJoin(schema_1.restaurants, (0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, schema_1.restaurants.id));
    return (0, response_1.SuccessResponse)(res, { data: wallets });
};
exports.getAllWallets = getAllWallets;
// ==========================================
// 2. GET SINGLE WALLET
// ==========================================
const getRestaurantWallet = async (req, res, next) => {
    try {
        const restaurantId = req.params.id;
        const wallet = await connection_1.db
            .select()
            .from(schema_1.restaurantWallets)
            .where((0, drizzle_orm_1.eq)(schema_1.restaurantWallets.restaurantId, restaurantId))
            .limit(1);
        if (!wallet[0]) {
            throw new NotFound_1.NotFound("Wallet not found");
            // أو تقدر تعمل: return next(new NotFound("Wallet not found"));
        }
        return (0, response_1.SuccessResponse)(res, { data: wallet[0] });
    }
    catch (error) {
        // تمرير الخطأ للـ Middleware الخاص بالـ Error Handling في Express
        next(error);
    }
};
exports.getRestaurantWallet = getRestaurantWallet;
// ==========================================
// 3. COLLECT CASH (Super Admin)
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
            type: "order_payment", // ممكن تغيرها لـ cash_collection لو ضايفها في الـ Enum بتاعك
            amount: collectAmount.toFixed(2),
            balanceBefore: currentBalance.toFixed(2), // 👈 بنسجل الرصيد القديم
            balanceAfter: newBalance.toFixed(2), // 👈 بنسجل الرصيد الجديد
            method: "cash",
            note: "Super admin collected cash (Debt settled)",
        });
    });
    return (0, response_1.SuccessResponse)(res, { message: "Cash collected and balance settled successfully" });
};
exports.collectCashFromRestaurant = collectCashFromRestaurant;
// ==========================================
// 4. APPROVE WITHDRAWAL
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
            type: "withdraw_approved", // استخدم النوع المناسب اللي في الـ Enum عندك (مثلا withdraw)
            amount: approveAmount.toFixed(2),
            balanceBefore: pending.toFixed(2),
            balanceAfter: (pending - approveAmount).toFixed(2),
            method: "bank", // أو wallet
            note: "Withdrawal approved by admin",
        });
    });
    return (0, response_1.SuccessResponse)(res, { message: "Withdrawal approved successfully" });
};
exports.approveWithdrawal = approveWithdrawal;
// ==========================================
// 5. WALLET TRANSACTIONS HISTORY
// ==========================================
const getWalletTransactions = async (req, res) => {
    // 👇 التعديل هنا
    const restaurantId = req.params.restaurantId || req.params.id;
    if (!restaurantId)
        throw new BadRequest_1.BadRequest("Restaurant ID is required");
    const data = await connection_1.db
        .select()
        .from(schema_1.restaurantWalletTransactions)
        .where((0, drizzle_orm_1.eq)(schema_1.restaurantWalletTransactions.restaurantId, restaurantId))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.restaurantWalletTransactions.createdAt)); // ترتيب من الأحدث للأقدم
    return (0, response_1.SuccessResponse)(res, { data });
};
exports.getWalletTransactions = getWalletTransactions;
