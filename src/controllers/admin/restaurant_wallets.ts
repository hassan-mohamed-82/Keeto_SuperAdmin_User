// controllers/admin/restaurantWallet.controller.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantWallets, restaurantWalletTransactions, restaurants } from "../../models/schema";
import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";

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

            restaurant: {
                id: restaurants.id,
                name: restaurants.name,
            }
        })
        .from(restaurantWallets)
        .leftJoin(restaurants, eq(restaurantWallets.restaurantId, restaurants.id));

    return SuccessResponse(res, { data: wallets });
};

// ==========================================
// 2. GET SINGLE WALLET
// ==========================================
export const getRestaurantWallet = async (req: Request, res: Response) => {
   const restaurantId = req.params.id;
    if (!restaurantId) throw new BadRequest("Restaurant ID is required");

    const wallet = await db
        .select()
        .from(restaurantWallets)
        .where(eq(restaurantWallets.restaurantId, restaurantId))
        .limit(1);

    if (!wallet[0]) throw new NotFound("Wallet not found");

    return SuccessResponse(res, { data: wallet[0] });
};

// ==========================================
// 3. COLLECT CASH (Super Admin)
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
            type: "order_payment", // ممكن تغيرها لـ cash_collection لو ضايفها في الـ Enum بتاعك
            amount: collectAmount.toFixed(2),
            balanceBefore: currentBalance.toFixed(2), // 👈 بنسجل الرصيد القديم
            balanceAfter: newBalance.toFixed(2),      // 👈 بنسجل الرصيد الجديد
            method: "cash",
            note: "Super admin collected cash (Debt settled)",
        });
    });

    return SuccessResponse(res, { message: "Cash collected and balance settled successfully" });
};

// ==========================================
// 4. APPROVE WITHDRAWAL
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
            type: "withdraw_approved", // استخدم النوع المناسب اللي في الـ Enum عندك (مثلا withdraw)
            amount: approveAmount.toFixed(2),
            balanceBefore: pending.toFixed(2), 
            balanceAfter: (pending - approveAmount).toFixed(2), 
            method: "bank", // أو wallet
            note: "Withdrawal approved by admin",
        });
    });

    return SuccessResponse(res, { message: "Withdrawal approved successfully" });
};

// ==========================================
// 5. WALLET TRANSACTIONS HISTORY
// ==========================================
export const getWalletTransactions = async (req: Request, res: Response) => {
    // 👇 التعديل هنا
    const restaurantId = req.params.restaurantId || req.params.id;

    if (!restaurantId) throw new BadRequest("Restaurant ID is required");

    const data = await db
        .select()
        .from(restaurantWalletTransactions)
        .where(eq(restaurantWalletTransactions.restaurantId, restaurantId))
        .orderBy(desc(restaurantWalletTransactions.createdAt)); // ترتيب من الأحدث للأقدم

    return SuccessResponse(res, { data });
};