import { Request, Response } from "express";
import { db } from "../../models/connection";
import { users, userFcmTokens, restaurants } from "../../models/schema";
import { eq, and, ne } from "drizzle-orm";
import { SuccessResponse } from "../../utils/response";
import { UnauthorizedError } from "../../Errors";
import { v4 as uuidv4 } from "uuid";

// ==========================================
// Update FCM Token for User 
// ==========================================
export const updateFcmToken = async (req: Request | any, res: Response) => {
    if (!req.user) throw new UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { fcmToken, restaurantId, deviceType } = req.body;

    const tokenToSave = fcmToken && String(fcmToken).trim() !== "" ? String(fcmToken).trim() : null;
    const devType: "web" | "android" | "ios" =
        deviceType === "ios" || deviceType === "android" ? deviceType : "web";

    // fallback القديم
    await db.update(users).set({ fcmToken: tokenToSave }).where(eq(users.id, userId));

    if (restaurantId) {
        if (tokenToSave) {
            let projectToSave = "primary";
            if (devType !== "web") {
                const [restaurant] = await db
                    .select({ ios: restaurants.iosFirebaseProject, android: restaurants.androidFirebaseProject })
                    .from(restaurants)
                    .where(eq(restaurants.id, restaurantId))
                    .limit(1);
                if (restaurant) {
                    projectToSave = (devType === "ios" ? restaurant.ios : restaurant.android) || "primary";
                }
            }

            // نفس التوكن عند يوزر تاني؟ امسحه
            await db.delete(userFcmTokens).where(and(
                eq(userFcmTokens.fcmToken, tokenToSave),
                ne(userFcmTokens.userId, userId)
            ));

            // الصف بيتحدد بـ (يوزر + مطعم + نوع الجهاز)
            const [existing] = await db.select().from(userFcmTokens).where(and(
                eq(userFcmTokens.userId, userId),
                eq(userFcmTokens.restaurantId, restaurantId),
                eq(userFcmTokens.deviceType, devType)
            )).limit(1);

            if (existing) {
                await db.update(userFcmTokens)
                    .set({ fcmToken: tokenToSave, firebaseProject: projectToSave, updatedAt: new Date() })
                    .where(eq(userFcmTokens.id, existing.id));
            } else {
                await db.insert(userFcmTokens).values({
                    id: uuidv4(),
                    userId,
                    restaurantId,
                    fcmToken: tokenToSave,
                    deviceType: devType,
                    firebaseProject: projectToSave
                });
            }
        } else {
            // logout: امسح توكن الجهاز ده بس
            await db.delete(userFcmTokens).where(and(
                eq(userFcmTokens.userId, userId),
                eq(userFcmTokens.restaurantId, restaurantId),
                eq(userFcmTokens.deviceType, devType)
            ));
        }
    } else if (!tokenToSave) {
        await db.delete(userFcmTokens).where(eq(userFcmTokens.userId, userId));
    }

    return SuccessResponse(res, {
        message: tokenToSave ? "FCM token updated successfully" : "FCM token removed successfully"
    });
};