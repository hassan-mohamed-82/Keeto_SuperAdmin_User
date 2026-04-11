import { Request, Response } from "express";
import { db } from "../../models/connection";
import { restaurantWallets, restaurants } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest } from "../../Errors/BadRequest";
import { NotFound } from "../../Errors/NotFound";

// جلب جميع المحافظ عشان السوبر أدمن يشوف مين عليه فلوس
export const getAllWallets = async (req: Request, res: Response) => {
    const wallets = await db
        .select({
            id: restaurantWallets.id,
            balance: restaurantWallets.balance,
            collectedCash: restaurantWallets.collectedCash,
            pendingWithdraw: restaurantWallets.pendingWithdraw,
            restaurant: {
                id: restaurants.id,
                name: restaurants.name
            }
        })
        .from(restaurantWallets)
        .leftJoin(restaurants, eq(restaurantWallets.restaurantId, restaurants.id));

    return SuccessResponse(res, { message: "successfully fetched all wallets", data: wallets });
};

// تحصيل الكاش من المطعم (Super Admin بيستلم فلوس من المطعم)
export const collectCashFromRestaurant = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) throw new BadRequest("amount is required and should be greater than 0");

    const wallet = await db.select().from(restaurantWallets).where(eq(restaurantWallets.restaurantId, restaurantId)).limit(1);
    if (!wallet[0]) throw new NotFound("restaurant wallet not found");

    const currentCash = parseFloat(wallet[0].collectedCash || "0");
    const collectAmount = parseFloat(amount);

    if (collectAmount > currentCash) {
        throw new BadRequest("amount entered is greater than the cash registered on the restaurant");
    }

    await db.update(restaurantWallets)
        .set({ collectedCash: (currentCash - collectAmount).toString() })
        .where(eq(restaurantWallets.restaurantId, restaurantId));

    return SuccessResponse(res, { message: ` successfully collected ${collectAmount} from the restaurant ` });
};

// موافقة السوبر أدمن على تحويل الفلوس للمطعم
export const approveWithdrawal = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;
    const { amount } = req.body;

    if (!amount || amount <= 0) throw new BadRequest("amount is required and should be greater than 0");

    const wallet = await db.select().from(restaurantWallets).where(eq(restaurantWallets.restaurantId, restaurantId)).limit(1);
    if (!wallet[0]) throw new NotFound("restaurant wallet not found");

    const currentPending = parseFloat(wallet[0].pendingWithdraw || "0");
    const totalWithdrawn = parseFloat(wallet[0].totalWithdrawn || "0");
    const approveAmount = parseFloat(amount);

    if (approveAmount > currentPending) {
        throw new BadRequest("amount to approve is greater than the pending withdrawal amount");
    }

    await db.update(restaurantWallets)
        .set({ 
            pendingWithdraw: (currentPending - approveAmount).toString(),
            totalWithdrawn: (totalWithdrawn + approveAmount).toString()
        })
        .where(eq(restaurantWallets.restaurantId, restaurantId));

    return SuccessResponse(res, { message: "successfully approved withdrawal" });
};


// جلب تفاصيل محفظة مطعم معين
export const getRestaurantWallet = async (req: Request, res: Response) => {
    const { restaurantId } = req.params;
    const wallet = await db
        .select({
            id: restaurantWallets.id,
            balance: restaurantWallets.balance,
            collectedCash: restaurantWallets.collectedCash,
            pendingWithdraw: restaurantWallets.pendingWithdraw,
            totalWithdrawn: restaurantWallets.totalWithdrawn,
            totalEarning: restaurantWallets.totalEarning,
            restaurant: {
                id: restaurants.id,
                name: restaurants.name
            }
        })
        .from(restaurantWallets)
        .leftJoin(restaurants, eq(restaurantWallets.restaurantId, restaurants.id))
        .where(eq(restaurantWallets.restaurantId, restaurantId))
        .limit(1);

    return SuccessResponse(res, { message: "successful fetched wallet details ", data: wallet });
};