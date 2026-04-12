// controllers/user/WalletController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { userWallets, userWalletTransactions } from "../../models/schema";
import { eq, and, desc } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { v4 as uuidv4 } from "uuid";

// =====================================================
// 1. شحن المحفظة (Add Fund to Wallet)
// =====================================================
export const addFundToWallet = async (req: Request, res: Response) => {
    const { userId, amount, paymentReference } = req.body;
    const depositAmount = parseFloat(amount);

    // تطبيق شرط الصورة: الحد الأدنى 100 جنيه
    if (depositAmount < 100) {
        throw new BadRequest("Deposit limit: Min 100 E£");
    }

    await db.transaction(async (tx) => {
        // نجيب محفظة العميل (ولو مش موجودة نكريتها)
        let [wallet] = await tx.select().from(userWallets).where(eq(userWallets.userId, userId)).limit(1);
        
        if (!wallet) {
            await tx.insert(userWallets).values({ id: uuidv4(), userId, balance: "0.00", loyaltyPoints: 0 });
            [wallet] = await tx.select().from(userWallets).where(eq(userWallets.userId, userId)).limit(1);
        }

        const currentBalance = parseFloat(wallet.balance || "0");

        // تسجيل الحركة في الـ History (Credit)
        await tx.insert(userWalletTransactions).values({
            id: uuidv4(),
            userId,
            type: "credit",
            transactionType: "added_via_payment",
            amount: depositAmount.toString(),
            balanceBefore: currentBalance.toString(),
            paymentMethod: paymentReference ? "Online Recharge" : "Manual",
            reference: paymentReference || "Online Recharge"
        });

        // تحديث الرصيد
        await tx.update(userWallets)
            .set({ balance: (currentBalance + depositAmount).toString() })
            .where(eq(userWallets.id, wallet.id));
    });

    return SuccessResponse(res, { message: "تم إضافة الرصيد لمحفظتك بنجاح" });
};

// =====================================================
// 2. تحويل النقاط لفلوس (Convert Loyalty Points)
// =====================================================
export const convertLoyaltyPoints = async (req: Request, res: Response) => {
    const { userId, pointsToConvert } = req.body;
    const points = parseInt(pointsToConvert);

    // افتراض: كل 100 نقطة = 10 جنيه
    const conversionRate = 0.1; 
    const amountToAdd = points * conversionRate;

    await db.transaction(async (tx) => {
        const [wallet] = await tx.select().from(userWallets).where(eq(userWallets.userId, userId)).limit(1);
        if (!wallet || wallet.loyaltyPoints! < points) {
            throw new BadRequest("نقاطك لا تكفي لإتمام التحويل");
        }

        const currentBalance = parseFloat(wallet.balance || "0");

        // تسجيل الحركة
        await tx.insert(userWalletTransactions).values({
            id: uuidv4(),
            userId,
            type: "credit",
            transactionType: "converted_loyalty",
            amount: amountToAdd.toString(),
            balanceBefore: currentBalance.toString(),
            paymentMethod: "Loyalty System",
            reference: `Converted ${points} points`
        });

        // تحديث المحفظة (خصم النقط وإضافة الفلوس)
        await tx.update(userWallets)
            .set({ 
                loyaltyPoints: wallet.loyaltyPoints! - points,
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
    const { userId } = req.params;
    const { filter } = req.query; // الفلتر اللي جاي من القائمة المنسدلة في الصورة

    let condition = eq(userWalletTransactions.userId, userId);

    // تطبيق الفلتر بناءً على اختيار اليوزر
    if (filter === "Order Transactions") {
        condition = and(eq(userWalletTransactions.userId, userId), eq(userWalletTransactions.transactionType, "order_transaction" as any)) as any;
    } else if (filter === "Converted from Loyalty Point") {
        condition = and(eq(userWalletTransactions.userId, userId), eq(userWalletTransactions.transactionType, "converted_loyalty" as any)) as any;
    } else if (filter === "Added via Payment Method") {
        condition = and(eq(userWalletTransactions.userId, userId), eq(userWalletTransactions.transactionType, "added_via_payment" as any)) as any;
    }
    // لو All Transactions مش هنضيف فلتر على النوع

    const history = await db.select().from(userWalletTransactions).where(condition).orderBy(desc(userWalletTransactions.createdAt));

    return SuccessResponse(res, { data: history });
};