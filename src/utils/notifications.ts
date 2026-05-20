import { messaging } from "./firebase";
import { db } from "../models/connection";
import { notifications, users, restaurants } from "../models/schema";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

/**
 * Utility to send a push notification via Firebase and save it to the DB.
 */
export const sendPushNotification = async (params: {
    recipientType: "user" | "restaurant";
    recipientId: string;
    title: string;
    body: string;
    data?: any; // Extra payload data
}) => {
    const { recipientType, recipientId, title, body, data } = params;

    // 1. Save notification to database regardless of FCM success/failure
    await db.insert(notifications).values({
        id: uuidv4(),
        recipientType,
        recipientId,
        title,
        body,
        data: data || {},
    });

    try {
        // 2. Look up the FCM token for the recipient
        let fcmToken: string | null = null;

        if (recipientType === "user") {
            const [user] = await db
                .select({ fcmToken: users.fcmToken })
                .from(users)
                .where(eq(users.id, recipientId))
                .limit(1);
            fcmToken = user?.fcmToken || null;
        } else {
            const [restaurant] = await db
                .select({ fcmToken: restaurants.fcmToken })
                .from(restaurants)
                .where(eq(restaurants.id, recipientId))
                .limit(1);
            fcmToken = restaurant?.fcmToken || null;
        }

        // 3. Send via Firebase if token exists
        if (fcmToken) {
            const message = {
                notification: {
                    title,
                    body,
                },
                data: {
                    // FCM data payload only accepts string values
                    payload: JSON.stringify(data || {}),
                },
                token: fcmToken,
            };

            await messaging.send(message);
            console.log(`[FCM] Notification sent successfully to ${recipientType} ${recipientId}`);
        } else {
            console.log(`[FCM] Skipped push: No FCM token found for ${recipientType} ${recipientId}`);
        }
    } catch (error) {
        console.error(`[FCM] Failed to send push notification to ${recipientType} ${recipientId}:`, error);
        // We don't throw the error so that the main business logic (like checkout) doesn't fail 
        // just because a notification failed to send.
    }
};
