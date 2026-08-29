// import { messaging } from "./firebase";
// import { db } from "../models/connection";
// import { notifications, users, restaurants } from "../models/schema";
// import { eq } from "drizzle-orm";
// import { v4 as uuidv4 } from "uuid";

// /**
//  * Utility to send a push notification via Firebase and save it to the DB.
//  */
// export const sendPushNotification = async (params: {
//     recipientType: "user" | "restaurant" | "superadmin";
//     recipientId: string;
//     title: string;
//     body: string;
//     data?: any; // Extra payload data
// }) => {
//     const { recipientType, recipientId, title, body, data } = params;

//     // 1. Save notification to database regardless of FCM success/failure
//     await db.insert(notifications).values({
//         id: uuidv4(),
//         recipientType,
//         recipientId,
//         title,
//         body,
//         data: data || {},
//         createdAt: new Date()
//     });

//     try {
//         // 2. Look up the FCM token for the recipient
//         let fcmToken: string | null = null;

//         if (recipientType === "user") {
//             const [user] = await db
//                 .select({ fcmToken: users.fcmToken })
//                 .from(users)
//                 .where(eq(users.id, recipientId))
//                 .limit(1);
//             fcmToken = user?.fcmToken || null;
//         } else if (recipientType === "restaurant") {
//             const [restaurant] = await db
//                 .select({ fcmToken: restaurants.fcmToken })
//                 .from(restaurants)
//                 .where(eq(restaurants.id, recipientId))
//                 .limit(1);
//             fcmToken = restaurant?.fcmToken || null;
//         } else if (recipientType === "superadmin") {
//             // Admins currently don't use FCM tokens (e.g. they use web dashboard)
//             fcmToken = null;
//         }

//         // 3. Send via Firebase if token exists
//         if (fcmToken) {
//             const message = {
//                 notification: {
//                     title,
//                     body,
//                 },
//                 data: {
//                     // FCM data payload only accepts string values
//                     payload: JSON.stringify(data || {}),
//                 },
//                 token: fcmToken,
//             };

//             await messaging.send(message);
//             console.log(`[FCM] Notification sent successfully to ${recipientType} ${recipientId}`);
//         } else {
//             console.log(`[FCM] Skipped push: No FCM token found for ${recipientType} ${recipientId}`);
//         }
//     } catch (error) {
//         console.error(`[FCM] Failed to send push notification to ${recipientType} ${recipientId}:`, error);
//         // We don't throw the error so that the main business logic (like checkout) doesn't fail
//         // just because a notification failed to send.
//     }
// };


import { messaging } from "./firebase";
import { db } from "../models/connection";
import { notifications, users, restaurants, restrauntadmin, restaurantSettings, userFcmTokens } from "../models/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

/**
 * Utility to send a push notification via Firebase and save it to the DB.
 */
export const sendPushNotification = async (params: {
    recipientType: "user" | "restaurant" | "superadmin";
    recipientId: string;
    branchId?: string | null;
    title: string;
    body: string;
    data?: any; // Extra payload data
}) => {
    const { recipientType, recipientId, branchId, title, body, data } = params;

    let payloadData: any = {
        ...(data || {}),
        recipientType,
        recipientId,
        branchId: branchId || data?.branchId || null,
        restaurantId: data?.restaurantId || (recipientType === "restaurant" ? recipientId : null)
    };

    // If recipient is a restaurant, attach repeat notification settings
    if (recipientType === "restaurant") {
        try {
            const [settings] = await db
                .select({
                    repeatNotification: restaurantSettings.repeatNotification,
                    repeatNotificationDuration: restaurantSettings.repeatNotificationDuration,
                    repeatNotificationStatuses: restaurantSettings.repeatNotificationStatuses,
                })
                .from(restaurantSettings)
                .where(eq(restaurantSettings.restaurantId, recipientId))
                .limit(1);

            if (settings) {
                payloadData = {
                    repeatNotification: settings.repeatNotification ?? false,
                    repeatNotificationDuration: settings.repeatNotificationDuration ?? 20,
                    repeatNotificationStatuses: settings.repeatNotificationStatuses ?? ["pending"],
                    ...payloadData,
                };
            }
        } catch (err) {
            console.error("[NOTIFICATIONS] Failed to load restaurant repeat settings:", err);
        }
    }

    // 1. Save notification to database regardless of FCM success/failure
    await db.insert(notifications).values({
        id: uuidv4(),
        recipientType,
        recipientId,
        title,
        body,
        data: payloadData,
        createdAt: new Date()
    });

    try {
        // 2. Look up the FCM tokens for the recipient(s)
        const tokens: string[] = [];

        if (recipientType === "user") {
            const targetRestaurantId = payloadData.restaurantId || data?.restaurantId;

            let userTokens: { fcmToken: string }[] = [];
            if (targetRestaurantId) {
                userTokens = await db
                    .select({ fcmToken: userFcmTokens.fcmToken })
                    .from(userFcmTokens)
                    .where(and(
                        eq(userFcmTokens.userId, recipientId),
                        or(
                            eq(userFcmTokens.restaurantId, targetRestaurantId),
                            sql`${userFcmTokens.restaurantId} IS NULL`
                        )
                    ));
            } else {
                userTokens = await db
                    .select({ fcmToken: userFcmTokens.fcmToken })
                    .from(userFcmTokens)
                    .where(eq(userFcmTokens.userId, recipientId));
            }

            for (const t of userTokens) {
                if (t.fcmToken && !tokens.includes(t.fcmToken)) {
                    tokens.push(t.fcmToken);
                }
            }

            // Fallback to legacy user fcmToken if userFcmTokens table has no records for this user/restaurant
            if (tokens.length === 0) {
                const [user] = await db
                    .select({ fcmToken: users.fcmToken })
                    .from(users)
                    .where(eq(users.id, recipientId))
                    .limit(1);
                if (user?.fcmToken) tokens.push(user.fcmToken);
            }
        } else if (recipientType === "restaurant") {
            // Main restaurant owner token
            const [restaurant] = await db
                .select({ fcmToken: restaurants.fcmToken })
                .from(restaurants)
                .where(eq(restaurants.id, recipientId))
                .limit(1);
            if (restaurant?.fcmToken) tokens.push(restaurant.fcmToken);

            // Fetch tokens from restrauntadmin based on branch
            let adminConditions = and(
                eq(restrauntadmin.restaurantId, recipientId),
                eq(restrauntadmin.status, "active")
            );

            if (branchId || payloadData.branchId) {
                const targetBranchId = branchId || payloadData.branchId;
                adminConditions = and(
                    eq(restrauntadmin.restaurantId, recipientId),
                    eq(restrauntadmin.status, "active"),
                    or(
                        eq(restrauntadmin.branchId, targetBranchId),
                        eq(restrauntadmin.type, "owner"),
                        eq(restrauntadmin.type, "subadmin")
                    )
                );
            }

            const admins = await db
                .select({ fcmToken: restrauntadmin.fcmToken })
                .from(restrauntadmin)
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
                        token,
                    };
                    await messaging.send(message);
                } catch (sendErr) {
                    console.error(`[FCM] Failed to send push to token ${token}:`, sendErr);
                }
            }));
            console.log(`[FCM] Notification sent successfully to ${uniqueTokens.length} recipients for ${recipientType} ${recipientId}`);
        } else {
            console.log(`[FCM] Skipped push: No FCM token found for ${recipientType} ${recipientId}`);
        }
    } catch (error) {
        console.error(`[FCM] Failed to send push notification to ${recipientType} ${recipientId}:`, error);
    }
};