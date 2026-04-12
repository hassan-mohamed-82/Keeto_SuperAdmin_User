// controllers/user/ProfileController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cities, countries, users, userWallets, zones, } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";

export const getProfile = async (req: Request | any, res: Response) => {
    const userId = req.user.id;

    const [userInfo] = await db
        .select({
            id: users.id,
            name: users.name,
            email: users.email,
            phone: users.phone,
            photo: users.photo,
            address: users.address,
            isVerified: users.isVerified,
            createdAt: users.createdAt,

            // 🔥 names بدل IDs
            countryName: countries.name,
            cityName: cities.name,
            zoneName: zones.name,
        })
        .from(users)
        .leftJoin(countries, eq(users.countryId, countries.id))
        .leftJoin(cities, eq(users.cityId, cities.id))
        .leftJoin(zones, eq(users.zoneId, zones.id))
        .where(eq(users.id, userId))
        .limit(1);

    const [wallet] = await db
        .select({
            balance: userWallets.balance
        })
        .from(userWallets)
        .where(eq(userWallets.userId, userId))
        .limit(1);

    return SuccessResponse(res, {
        data: {
            user: {
                id: userInfo.id,
                name: userInfo.name,
                email: userInfo.email,
                phone: userInfo.phone,
                photo: userInfo.photo,

                location: {
                    country: userInfo.countryName,
                    city: userInfo.cityName,
                    zone: userInfo.zoneName,
                    address: userInfo.address,
                },

                isVerified: userInfo.isVerified,
                createdAt: userInfo.createdAt,
            },
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