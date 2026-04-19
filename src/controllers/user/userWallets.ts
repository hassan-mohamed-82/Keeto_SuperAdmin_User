// controllers/user/WalletController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { paymentMethods, userWallets, userWalletTransactions } from "../../models/schema";
import { eq, and, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

// =====================================================
// 1. شحن المحفظة (Add Fund to Wallet)
// =====================================================
export const addFundToWallet = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const {
        amount,
        paymentMethodId,
        receiptImage
    } = req.body;

    const depositAmount = Number(amount);

    const [method] = await db
        .select()
        .from(paymentMethods)
        .where(eq(paymentMethods.id, paymentMethodId))
        .limit(1);

    if (!method) throw new BadRequest("Invalid payment method");

    const isManual = !!receiptImage;

    await db.transaction(async (tx) => {

        let [wallet] = await tx
            .select()
            .from(userWallets)
            .where(eq(userWallets.userId, userId as string))
            .limit(1);

        if (!wallet) {
            await tx.insert(userWallets).values({
                id: uuidv4(),
                userId: userId as string,
                balance: "0.00",
                loyaltyPoints: 0,
            });

            [wallet] = await tx
                .select()
                .from(userWallets)
                .where(eq(userWallets.userId, userId as string))
                .limit(1);
        }

        const before = Number(wallet.balance || "0");

        // 🟡 MANUAL (pending)
        if (isManual) {
            await tx.insert(userWalletTransactions).values({
                id: uuidv4(),
                userId: userId as string,
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
        await tx.insert(userWalletTransactions).values({
            id: uuidv4(),
            userId: userId as string,
            paymentMethodId,
            type: "credit",
            transactionType: "add_fund",
            amount: depositAmount.toString(),
            balanceBefore: before.toString(),
            status: "approved",
            reference: method.name
        });

        await tx.update(userWallets)
            .set({ balance: (before + depositAmount).toString() })
            .where(eq(userWallets.id, wallet.id));
    });

    return SuccessResponse(res, {
        message: isManual
            ? "Waiting for admin approval"
            : "Wallet updated successfully"
    });
};

// =====================================================
// 2. تحويل النقاط لفلوس (Convert Loyalty Points)
// =====================================================
export const convertLoyaltyPoints = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { pointsToConvert } = req.body;
    const points = parseInt(pointsToConvert);

    // افتراض: كل 100 نقطة = 10 جنيه
    const conversionRate = 0.1; 
    const amountToAdd = points * conversionRate;

    await db.transaction(async (tx) => {
        const [wallet] = await tx.select().from(userWallets).where(eq(userWallets.userId, userId as string)).limit(1);
        
        const currentLoyaltyPoints = wallet?.loyaltyPoints || 0;
        
        if (!wallet || currentLoyaltyPoints < points) {
            throw new BadRequest("نقاطك لا تكفي لإتمام التحويل");
        }

        const currentBalance = parseFloat(wallet.balance || "0");

        // تسجيل الحركة
        await tx.insert(userWalletTransactions).values({
            id: uuidv4(),
            userId: userId as string,
            type: "credit",
            transactionType: "converted_loyalty",
            amount: amountToAdd.toString(),
            balanceBefore: currentBalance.toString(),
            reference: `Converted ${points} points`
            // Note: paymentMethodId is omitted as this is an internal conversion
        });

        // تحديث المحفظة (خصم النقط وإضافة الفلوس)
        await tx.update(userWallets)
            .set({ 
                loyaltyPoints: currentLoyaltyPoints - points,
                balance: (currentBalance + amountToAdd).toString() 
            })
            .where(eq(userWallets.id, wallet.id));
    });

    return SuccessResponse(res, { message: "تم تحويل النقاط لرصيد بنجاح" });
};

// =====================================================
// 3. عرض سجل المحفظة مع الفلتر (Wallet History Filter)
// =====================================================
export const getWalletHistory = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const { filter } = req.query;

    let conditions = eq(userWalletTransactions.userId, userId as string);

    if (filter === "orders") {
        conditions = and(
            eq(userWalletTransactions.userId, userId as string),
            eq(userWalletTransactions.transactionType, "order_payment")
        ) as any;
    }

    else if (filter === "deposit") {
        conditions = and(
            eq(userWalletTransactions.userId, userId as string),
            eq(userWalletTransactions.transactionType, "add_fund")
        ) as any;
    }

    else if (filter === "manual_pending") {
        conditions = and(
            eq(userWalletTransactions.userId, userId as string),
            eq(userWalletTransactions.status, "pending")
        ) as any;
    }

    else if (filter === "manual_approved") {
        conditions = and(
            eq(userWalletTransactions.userId, userId as string),
            eq(userWalletTransactions.status, "approved")
        ) as any;
    }

    else if (filter === "manual_rejected") {
        conditions = and(
            eq(userWalletTransactions.userId, userId as string),
            eq(userWalletTransactions.status, "rejected")
        ) as any;
    }

    const history = await db
        .select({
            id: userWalletTransactions.id,
            amount: userWalletTransactions.amount,
            type: userWalletTransactions.type,
            transactionType: userWalletTransactions.transactionType,
            status: userWalletTransactions.status,
            balanceBefore: userWalletTransactions.balanceBefore,
            reference: userWalletTransactions.reference,
            receiptImage: userWalletTransactions.receiptImage,
            createdAt: userWalletTransactions.createdAt,
            paymentMethodId: userWalletTransactions.paymentMethodId,
        })
        .from(userWalletTransactions)
        .where(conditions)
        .orderBy(desc(userWalletTransactions.createdAt));

    return SuccessResponse(res, { data: history });
};