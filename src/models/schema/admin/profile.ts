import { Request, Response } from "express";
import { db } from "../../../models/connection";
import { restrauntadmin } from "../../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../../utils/response";
import { BadRequest, NotFound, UnauthorizedError } from "../../../Errors";
import bcrypt from "bcrypt";

export const getProfile = async (req: Request, res: Response) => {
    const adminId = req.user?.restaurantId || req.user?.id;

    if (!adminId) {
        throw new UnauthorizedError("Unauthorized");
    }

    const [adminUser] = await db
        .select({
            id: restrauntadmin.id,
            name: restrauntadmin.name,
            email: restrauntadmin.email,
            phoneNumber: restrauntadmin.phoneNumber,
            type: restrauntadmin.type,
            status: restrauntadmin.status,
            restaurantId: restrauntadmin.restaurantId,
            branchId: restrauntadmin.branchId,
            fcmToken: restrauntadmin.fcmToken,
            createdAt: restrauntadmin.createdAt,
            updatedAt: restrauntadmin.updatedAt,
        })
        .from(restrauntadmin)
        .where(eq(restrauntadmin.id, adminId))
        .limit(1);

    if (!adminUser) {
        throw new NotFound("Admin profile not found");
    }

    return SuccessResponse(res, { profile: adminUser });
};

export const updateProfile = async (req: Request, res: Response) => {
    const adminId = req.user?.restaurantId || req.user?.id;
    const { name, phoneNumber, fcmToken } = req.body;

    if (!adminId) {
        throw new UnauthorizedError("Unauthorized");
    }

    const [adminUser] = await db
        .select()
        .from(restrauntadmin)
        .where(eq(restrauntadmin.id, adminId))
        .limit(1);

    if (!adminUser) {
        throw new NotFound("Admin profile not found");
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (fcmToken !== undefined) updateData.fcmToken = fcmToken;

    if (Object.keys(updateData).length > 0) {
        await db
            .update(restrauntadmin)
            .set(updateData)
            .where(eq(restrauntadmin.id, adminId));
    }

    const [updatedAdmin] = await db
        .select({
            id: restrauntadmin.id,
            name: restrauntadmin.name,
            email: restrauntadmin.email,
            phoneNumber: restrauntadmin.phoneNumber,
            type: restrauntadmin.type,
            status: restrauntadmin.status,
            restaurantId: restrauntadmin.restaurantId,
            branchId: restrauntadmin.branchId,
            fcmToken: restrauntadmin.fcmToken,
        })
        .from(restrauntadmin)
        .where(eq(restrauntadmin.id, adminId))
        .limit(1);

    return SuccessResponse(res, { message: "Profile updated successfully", profile: updatedAdmin });
};

export const changePassword = async (req: Request, res: Response) => {
    const adminId = req.user?.id;
    const { oldPassword, newPassword } = req.body;

    if (!adminId) {
        throw new UnauthorizedError("Unauthorized");
    }

    if (!oldPassword || !newPassword) {
        throw new BadRequest("Old password and new password are required");
    }

    const [adminUser] = await db
        .select()
        .from(restrauntadmin)
        .where(eq(restrauntadmin.id, adminId))
        .limit(1);

    if (!adminUser) {
        throw new NotFound("Admin profile not found");
    }

    const isPasswordValid = await bcrypt.compare(oldPassword, adminUser.password);
    if (!isPasswordValid) {
        throw new BadRequest("Invalid old password");
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await db
        .update(restrauntadmin)
        .set({ password: hashedPassword })
        .where(eq(restrauntadmin.id, adminId));

    return SuccessResponse(res, { message: "Password changed successfully" });
};
