"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushNotification = void 0;
const firebase_1 = require("./firebase");
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
/**
 * Utility to send a push notification via Firebase and save it to the DB.
 */
const sendPushNotification = async (params) => {
    const { recipientType, recipientId, title, body, data } = params;
    // 1. Save notification to database regardless of FCM success/failure
    await connection_1.db.insert(schema_1.notifications).values({
        id: (0, uuid_1.v4)(),
        recipientType,
        recipientId,
        title,
        body,
        data: data || {},
    });
    try {
        // 2. Look up the FCM token for the recipient
        let fcmToken = null;
        if (recipientType === "user") {
            const [user] = await connection_1.db
                .select({ fcmToken: schema_1.users.fcmToken })
                .from(schema_1.users)
                .where((0, drizzle_orm_1.eq)(schema_1.users.id, recipientId))
                .limit(1);
            fcmToken = user?.fcmToken || null;
        }
        else {
            const [restaurant] = await connection_1.db
                .select({ fcmToken: schema_1.restaurants.fcmToken })
                .from(schema_1.restaurants)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, recipientId))
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
            await firebase_1.messaging.send(message);
            console.log(`[FCM] Notification sent successfully to ${recipientType} ${recipientId}`);
        }
        else {
            console.log(`[FCM] Skipped push: No FCM token found for ${recipientType} ${recipientId}`);
        }
    }
    catch (error) {
        console.error(`[FCM] Failed to send push notification to ${recipientType} ${recipientId}:`, error);
        // We don't throw the error so that the main business logic (like checkout) doesn't fail 
        // just because a notification failed to send.
    }
};
exports.sendPushNotification = sendPushNotification;
