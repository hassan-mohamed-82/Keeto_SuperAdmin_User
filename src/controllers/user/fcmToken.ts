import { Request, Response } from "express";
import { db } from "../../models/connection";
import { users } from "../../models/schema";
import { eq } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";
import { BadRequest } from "../../Errors/BadRequest";

// ==========================================
// Update FCM Token for User
// ==========================================
export const updateFcmToken = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { fcmToken } = req.body;

    if (!fcmToken) {
        throw new BadRequest("FCM Token is required");
    }

    await db.update(users)
        .set({ fcmToken })
        .where(eq(users.id, userId));

    return SuccessResponse(res, { message: "FCM token updated successfully" });
};
