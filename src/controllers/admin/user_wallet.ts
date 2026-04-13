import { db } from "../../models/connection";
import { userWallets, userWalletTransactions } from "../../models/schema";
import { SuccessResponse } from "../../utils/response";
import { eq } from "drizzle-orm";
import { BadRequest } from "../../Errors/BadRequest";
import { Request, Response } from "express";
export const approveWalletTransaction = async (req: Request, res: Response) => {
    const { transactionId } = req.params;

    const [txData] = await db
        .select()
        .from(userWalletTransactions)
        .where(eq(userWalletTransactions.id, transactionId))
        .limit(1);

    if (!txData || txData.status !== "pending") {
        throw new BadRequest("Invalid transaction");
    }

    const [wallet] = await db
        .select()
        .from(userWallets)
        .where(eq(userWallets.userId, txData.userId))
        .limit(1);

    const newBalance = Number(wallet.balance) + Number(txData.amount);

    await db.transaction(async (dbTx) => {

        await dbTx.update(userWalletTransactions)
            .set({ status: "approved" })
            .where(eq(userWalletTransactions.id, transactionId));

        await dbTx.update(userWallets)
            .set({ balance: newBalance.toString() })
            .where(eq(userWallets.id, wallet.id));
    });

    return SuccessResponse(res, { message: "Transaction approved" });
};

export const rejectWalletTransaction = async (req: Request, res: Response) => {
    const { transactionId } = req.params;

    await db.update(userWalletTransactions)
        .set({ status: "rejected" })
        .where(eq(userWalletTransactions.id, transactionId));

    return SuccessResponse(res, { message: "Transaction rejected" });
};