// controllers/admin/restaurantWallet.controller.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantWallets, restaurantWalletTransactions, restaurants } from "../../models/schema";
import { eq } from "drizzle-orm";
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
    const { restaurantId } = req.params;

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
    const { restaurantId } = req.params;
    const { amount } = req.body;

    const collectAmount = Number(amount);
    if (!collectAmount || collectAmount <= 0) throw new BadRequest("Invalid amount");

    const wallet = await db
        .select()
        .from(restaurantWallets)
        .where(eq(restaurantWallets.restaurantId, restaurantId))
        .limit(1);

    if (!wallet[0]) throw new NotFound("Wallet not found");

    const currentCash = Number(wallet[0].collectedCash || 0);

    if (collectAmount > currentCash) {
        throw new BadRequest("Not enough collected cash");
    }

    const before = currentCash;
    const after = currentCash - collectAmount;

    await db.transaction(async (tx) => {

        // update wallet
        await tx
            .update(restaurantWallets)
            .set({ collectedCash: after.toString() })
            .where(eq(restaurantWallets.restaurantId, restaurantId));

        // log transaction
        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId,
            type: "cash_collection",
            amount: collectAmount.toString(),
            balanceBefore: before.toString(),
            balanceAfter: after.toString(),
            method: "cash",
            note: "Super admin collected cash",
        });
    });

    return SuccessResponse(res, { message: "Cash collected successfully" });
};


// ==========================================
// 4. APPROVE WITHDRAWAL
// ==========================================
export const approveWithdrawal = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;
    const { amount } = req.body;

    const approveAmount = Number(amount);
    if (!approveAmount || approveAmount <= 0) throw new BadRequest("Invalid amount");

    const wallet = await db
        .select()
        .from(restaurantWallets)
        .where(eq(restaurantWallets.restaurantId, restaurantId))
        .limit(1);

    if (!wallet[0]) throw new NotFound("Wallet not found");

    const pending = Number(wallet[0].pendingWithdraw || 0);
    const withdrawn = Number(wallet[0].totalWithdrawn || 0);

    if (approveAmount > pending) {
        throw new BadRequest("Amount exceeds pending withdraw");
    }

    await db.transaction(async (tx) => {

        await tx.update(restaurantWallets)
            .set({
                pendingWithdraw: (pending - approveAmount).toString(),
                totalWithdrawn: (withdrawn + approveAmount).toString()
            })
            .where(eq(restaurantWallets.restaurantId, restaurantId));

        await tx.insert(restaurantWalletTransactions).values({
            id: uuidv4(),
            restaurantId,
            type: "withdraw_approved",
            amount: approveAmount.toString(),
            balanceBefore: pending.toString(),
            balanceAfter: (pending - approveAmount).toString(),
            method: "bank",
            note: "Withdrawal approved by admin",
        });
    });

    return SuccessResponse(res, { message: "Withdrawal approved" });
};


// ==========================================
// 5. WALLET TRANSACTIONS HISTORY
// ==========================================
export const getWalletTransactions = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;

    const data = await db
        .select()
        .from(restaurantWalletTransactions)
        .where(eq(restaurantWalletTransactions.restaurantId, restaurantId));

    return SuccessResponse(res, { data });
};