// controllers/user/ProfileController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { users, userWallets, } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";

export const getProfile = async (req: Request | any, res: Response) => {
    const userId = req.user.id; // من التوكن

    // 1. جلب بيانات اليوزر الأساسية
    const [userInfo] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    // 2. جلب رصيد المحفظة
    const [wallet] = await db.select().from(userWallets).where(eq(userWallets.userId, userId)).limit(1);

  

    return SuccessResponse(res, {
        data: {
            user: userInfo,
            walletBalance: wallet?.balance || "0.00",
        }
    });
};

export const updateProfile = async (req: Request | any, res: Response) => {
    const userId = req.user.id;
    const { name, phone, photo } = req.body;

    await db.update(users)
        .set({ name, phone, photo })
        .where(eq(users.id, userId));

    return SuccessResponse(res, { message: "Profile updated successfully" });
};