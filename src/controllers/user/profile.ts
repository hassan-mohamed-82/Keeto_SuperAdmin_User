// controllers/user/ProfileController.ts
import { Request, Response } from "express";
import { db } from "../../models/connection";
import { cities, countries, orders, users, userWallets, zones, userRestaurantPoints, restaurants } from "../../models/schema";
import { eq, sql, and } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { BadRequest, NotFound, UnauthorizedError } from "../../Errors";
import bcrypt from "bcrypt";

export const getProfile = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;

    const [userInfo] = await db
        .select({
            id: users.id,
            name: users.name,
            email: users.email,
            phone: users.phone,
            photo: users.photo,
            isVerified: users.isVerified,
            createdAt: users.createdAt,

        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    const [ordersCount] = await db.select({count: sql`COUNT(*)`}).from(orders)
        .where(eq(orders.userId, userId));

    const [wallet] = await db
        .select({
            balance: userWallets.balance
        })
        .from(userWallets)
        .where(eq(userWallets.userId, userId))
        .limit(1);
    // const userPoints = await db
    //     .select({
    //         restaurantId: userRestaurantPoints.restaurantId,
    //         restaurantName: restaurants.name,
    //         points: userRestaurantPoints.points
    //     })
    //     .from(userRestaurantPoints)
    //     .leftJoin(restaurants, eq(restaurants.id, userRestaurantPoints.restaurantId))
    //     .where(eq(userRestaurantPoints.userId, userId));

    return SuccessResponse(res, {
        data: {
            user: {
                id: userInfo.id,
                name: userInfo.name,
                email: userInfo.email,
                phone: userInfo.phone,
                photo: userInfo.photo,



                isVerified: userInfo.isVerified,
                createdAt: userInfo.createdAt,
            },
            walletBalance: wallet?.balance || "0.00",
            ordersCount: ordersCount?.count || 0,
            // restaurantPoints: userPoints
        }
    });
};

// ==========================================
// Get User Points for a Specific Restaurant
// ==========================================
export const getRestaurantPoints = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { restaurantId } = req.params;

    if (!restaurantId) throw new BadRequest("restaurantId is required");

    const [pointsRecord] = await db
        .select({
            restaurantId: userRestaurantPoints.restaurantId,
            restaurantName: restaurants.name,
            points: userRestaurantPoints.points,
            updatedAt: userRestaurantPoints.updatedAt,
        })
        .from(userRestaurantPoints)
        .leftJoin(restaurants, eq(restaurants.id, userRestaurantPoints.restaurantId))
        .where(
            and(
                eq(userRestaurantPoints.userId, userId),
                eq(userRestaurantPoints.restaurantId, restaurantId)
            )
        )
        .limit(1);

    return SuccessResponse(res, {
        data: {
            restaurantId,
            restaurantName: pointsRecord?.restaurantName || null,
            points: pointsRecord?.points || 0,
            updatedAt: pointsRecord?.updatedAt || null,
        }
    });
};
export const updateProfile = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { name, phone, photo } = req.body;

    await db.update(users)
        .set({ name, phone, photo })
        .where(eq(users.id, userId));

    return SuccessResponse(res, { message: "Profile updated successfully" });
};


export const changepassword = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { oldPassword, newPassword } = req.body;

    if (!userId) {
        throw new UnauthorizedError("Unauthorized");
    }

    if (!oldPassword || !newPassword) {
        throw new BadRequest("Old password and new password are required");
    }

    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (!user) {
        throw new NotFound("Admin profile not found");
    }

    if (!user.password) {
        throw new BadRequest("Cannot change password for this account");
    }
    const passwordMatch = await bcrypt.compare(oldPassword, user.password);
    if (!passwordMatch) {
        throw new BadRequest("Invalid old password");
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    await db
    .update(users)
        .set({ password: hashedPassword })
        .where(eq(users.id, userId));

    return SuccessResponse(res, { message: "Password changed successfully" });
};

// ==========================================
// Delete Account (Soft Delete)
// ==========================================
export const deleteAccount = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
        throw new UnauthorizedError("Unauthorized");
    }

    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (!user) {
        throw new NotFound("User not found");
    }

    if (user.isDeleted) {
        throw new BadRequest("Account is already deleted");
    }

    // Soft delete the user
    await db.update(users)
        .set({ 
            isDeleted: true,
            deletedAt: new Date()
        })
        .where(eq(users.id, userId));

    return SuccessResponse(res, { message: "Account deleted successfully" });
};