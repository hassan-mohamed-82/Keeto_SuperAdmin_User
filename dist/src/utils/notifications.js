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
    const { recipientType, recipientId, branchId, title, body, data } = params;
    let payloadData = {
        ...(data || {}),
        recipientType,
        recipientId,
        branchId: branchId || data?.branchId || null,
        restaurantId: data?.restaurantId || (recipientType === "restaurant" ? recipientId : null),
        sound: 'notification_sound.wav'
    };
    // If recipient is a restaurant, attach repeat notification settings
    if (recipientType === "restaurant") {
        try {
            const [settings] = await connection_1.db
                .select({
                repeatNotification: schema_1.restaurantSettings.repeatNotification,
                repeatNotificationDuration: schema_1.restaurantSettings.repeatNotificationDuration,
                repeatNotificationStatuses: schema_1.restaurantSettings.repeatNotificationStatuses,
            })
                .from(schema_1.restaurantSettings)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurantSettings.restaurantId, recipientId))
                .limit(1);
            if (settings) {
                payloadData = {
                    repeatNotification: settings.repeatNotification ?? false,
                    repeatNotificationDuration: settings.repeatNotificationDuration ?? 20,
                    repeatNotificationStatuses: settings.repeatNotificationStatuses ?? ["pending"],
                    ...payloadData,
                };
            }
        }
        catch (err) {
            console.error("[NOTIFICATIONS] Failed to load restaurant repeat settings:", err);
        }
    }
    // 1. Save notification to database regardless of FCM success/failure
    await connection_1.db.insert(schema_1.notifications).values({
        id: (0, uuid_1.v4)(),
        recipientType,
        recipientId,
        title,
        body,
        data: payloadData,
        createdAt: new Date()
    });
    try {
        // 2. Look up the FCM tokens for the recipient(s)
        const tokens = [];
        if (recipientType === "user") {
            const targetRestaurantId = payloadData.restaurantId || data?.restaurantId;
            let userTokens = [];
            if (targetRestaurantId) {
                userTokens = await connection_1.db
                    .select({ fcmToken: schema_1.userFcmTokens.fcmToken })
                    .from(schema_1.userFcmTokens)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.userId, recipientId), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.restaurantId, targetRestaurantId), (0, drizzle_orm_1.sql) `${schema_1.userFcmTokens.restaurantId} IS NULL`)));
            }
            else {
                userTokens = await connection_1.db
                    .select({ fcmToken: schema_1.userFcmTokens.fcmToken })
                    .from(schema_1.userFcmTokens)
                    .where((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.userId, recipientId));
            }
            for (const t of userTokens) {
                if (t.fcmToken && !tokens.includes(t.fcmToken)) {
                    tokens.push(t.fcmToken);
                }
            }
            // Fallback to legacy user fcmToken if userFcmTokens table has no records for this user/restaurant
            if (tokens.length === 0) {
                const [user] = await connection_1.db
                    .select({ fcmToken: schema_1.users.fcmToken })
                    .from(schema_1.users)
                    .where((0, drizzle_orm_1.eq)(schema_1.users.id, recipientId))
                    .limit(1);
                if (user?.fcmToken)
                    tokens.push(user.fcmToken);
            }
        }
        else if (recipientType === "restaurant") {
            // Main restaurant owner token
            const [restaurant] = await connection_1.db
                .select({ fcmToken: schema_1.restaurants.fcmToken })
                .from(schema_1.restaurants)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, recipientId))
                .limit(1);
            if (restaurant?.fcmToken)
                tokens.push(restaurant.fcmToken);
            // Fetch tokens from restrauntadmin based on branch
            let adminConditions = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.restaurantId, recipientId), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.status, "active"));
            if (branchId || payloadData.branchId) {
                const targetBranchId = branchId || payloadData.branchId;
                adminConditions = (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.restaurantId, recipientId), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.status, "active"), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.branchId, targetBranchId), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "owner"), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "subadmin")));
            }
            const admins = await connection_1.db
                .select({ fcmToken: schema_1.restrauntadmin.fcmToken })
                .from(schema_1.restrauntadmin)
                .where(adminConditions);
            for (const adm of admins) {
                if (adm.fcmToken && !tokens.includes(adm.fcmToken)) {
                    tokens.push(adm.fcmToken);
                }
            }
        }
        // 3. Send via Firebase if token exists
        const uniqueTokens = [...new Set(tokens.filter(t => !!t))];
        if (uniqueTokens.length > 0) {
            await Promise.all(uniqueTokens.map(async (token) => {
                try {
                    const message = {
                        notification: {
                            title,
                            body,
                        },
                        data: {
                            payload: JSON.stringify(payloadData),
                        },
                        apns: {
                            payload: {
                                aps: {
                                    sound: "notification_sound.wav",
                                },
                            },
                        },
                        token,
                    };
                    await firebase_1.messaging.send(message);
                }
                catch (sendErr) {
                    console.error(`[FCM] Failed to send push to token ${token}:`, sendErr);
                }
            }));
            console.log(`[FCM] Notification sent successfully to ${uniqueTokens.length} recipients for ${recipientType} ${recipientId}`);
        }
        else {
            console.log(`[FCM] Skipped push: No FCM token found for ${recipientType} ${recipientId}`);
        }
    }
    catch (error) {
        console.error(`[FCM] Failed to send push notification to ${recipientType} ${recipientId}:`, error);
    }
};
exports.sendPushNotification = sendPushNotification;
