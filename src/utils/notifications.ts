// import { messaging } from "./firebase";
// import { db } from "../models/connection";
// import { notifications, users, restaurants, restrauntadmin, restaurantSettings, userFcmTokens } from "../models/schema";
// import { eq, and, or, sql } from "drizzle-orm";
// import { v4 as uuidv4 } from "uuid";

// /**
//  * Utility to send a push notification via Firebase and save it to the DB.
//  */
// export const sendPushNotification = async (params: {
//     recipientType: "user" | "restaurant" | "superadmin";
//     recipientId: string;
//     branchId?: string | null;
//     title: string;
//     body: string;
//     data?: any; // Extra payload data
// }) => {
//     const { recipientType, recipientId, branchId, title, body, data } = params;

//     let payloadData: any = {
//         ...(data || {}),
//         recipientType,
//         recipientId,
//         branchId: branchId || data?.branchId || null,
//         restaurantId: data?.restaurantId || (recipientType === "restaurant" ? recipientId : null),
//         sound: 'notification_sound.wav'
//     };

//     // If recipient is a restaurant, attach repeat notification settings
//     if (recipientType === "restaurant") {
//         try {
//             const [settings] = await db
//                 .select({
//                     repeatNotification: restaurantSettings.repeatNotification,
//                     repeatNotificationDuration: restaurantSettings.repeatNotificationDuration,
//                     repeatNotificationStatuses: restaurantSettings.repeatNotificationStatuses,
//                 })
//                 .from(restaurantSettings)
//                 .where(eq(restaurantSettings.restaurantId, recipientId))
//                 .limit(1);

//             if (settings) {
//                 payloadData = {
//                     repeatNotification: settings.repeatNotification ?? false,
//                     repeatNotificationDuration: settings.repeatNotificationDuration ?? 20,
//                     repeatNotificationStatuses: settings.repeatNotificationStatuses ?? ["pending"],
//                     ...payloadData,
//                 };
//             }
//         } catch (err) {
//             console.error("[NOTIFICATIONS] Failed to load restaurant repeat settings:", err);
//         }
//     }

//     // 1. Save notification to database regardless of FCM success/failure
//     await db.insert(notifications).values({
//         id: uuidv4(),
//         recipientType,
//         recipientId,
//         title,
//         body,
//         data: payloadData,
//         createdAt: new Date()
//     });

//     try {
//         // 2. Look up the FCM tokens for the recipient(s)
//         const tokens: string[] = [];

//         if (recipientType === "user") {
//             const targetRestaurantId = payloadData.restaurantId || data?.restaurantId;

//             let userTokens: { fcmToken: string }[] = [];
//             if (targetRestaurantId) {
//                 userTokens = await db
//                     .select({ fcmToken: userFcmTokens.fcmToken })
//                     .from(userFcmTokens)
//                     .where(and(
//                         eq(userFcmTokens.userId, recipientId),
//                         or(
//                             eq(userFcmTokens.restaurantId, targetRestaurantId),
//                             sql`${userFcmTokens.restaurantId} IS NULL`
//                         )
//                     ));
//             } else {
//                 userTokens = await db
//                     .select({ fcmToken: userFcmTokens.fcmToken })
//                     .from(userFcmTokens)
//                     .where(eq(userFcmTokens.userId, recipientId));
//             }

//             for (const t of userTokens) {
//                 if (t.fcmToken && !tokens.includes(t.fcmToken)) {
//                     tokens.push(t.fcmToken);
//                 }
//             }

//             // Fallback to legacy user fcmToken if userFcmTokens table has no records for this user/restaurant
//             if (tokens.length === 0) {
//                 const [user] = await db
//                     .select({ fcmToken: users.fcmToken })
//                     .from(users)
//                     .where(eq(users.id, recipientId))
//                     .limit(1);
//                 if (user?.fcmToken) tokens.push(user.fcmToken);
//             }
//         } else if (recipientType === "restaurant") {
//             // Main restaurant owner token
//             const [restaurant] = await db
//                 .select({ fcmToken: restaurants.fcmToken })
//                 .from(restaurants)
//                 .where(eq(restaurants.id, recipientId))
//                 .limit(1);
//             if (restaurant?.fcmToken) tokens.push(restaurant.fcmToken);

//             // Fetch tokens from restrauntadmin based on branch
//             let adminConditions = and(
//                 eq(restrauntadmin.restaurantId, recipientId),
//                 eq(restrauntadmin.status, "active")
//             );

//             if (branchId || payloadData.branchId) {
//                 const targetBranchId = branchId || payloadData.branchId;
//                 adminConditions = and(
//                     eq(restrauntadmin.restaurantId, recipientId),
//                     eq(restrauntadmin.status, "active"),
//                     or(
//                         eq(restrauntadmin.branchId, targetBranchId),
//                         eq(restrauntadmin.type, "owner"),
//                         eq(restrauntadmin.type, "subadmin")
//                     )
//                 );
//             }

//             const admins = await db
//                 .select({ fcmToken: restrauntadmin.fcmToken })
//                 .from(restrauntadmin)
//                 .where(adminConditions);

//             for (const adm of admins) {
//                 if (adm.fcmToken && !tokens.includes(adm.fcmToken)) {
//                     tokens.push(adm.fcmToken);
//                 }
//             }
//         }

//         // 3. Send via Firebase if token exists
//         const uniqueTokens = [...new Set(tokens.filter(t => !!t))];

//         if (uniqueTokens.length > 0) {
//             await Promise.all(uniqueTokens.map(async (token) => {
//                 try {
//                     const message = {
//                         notification: {
//                             title,
//                             body,
//                         },
//                         data: {
//                             payload: JSON.stringify(payloadData),
//                         },
//                         apns: {
//                             payload: {
//                                 aps: {
//                                     sound: "notification_sound.wav",
//                                 },
//                             },
//                         },
//                         token,
//                     };
//                     await messaging.send(message);
//                 } catch (sendErr) {
//                     console.error(`[FCM] Failed to send push to token ${token}:`, sendErr);
//                 }
//             }));
//             console.log(`[FCM] Notification sent successfully to ${uniqueTokens.length} recipients for ${recipientType} ${recipientId}`);
//         } else {
//             console.log(`[FCM] Skipped push: No FCM token found for ${recipientType} ${recipientId}`);
//         }
//     } catch (error) {
//         console.error(`[FCM] Failed to send push notification to ${recipientType} ${recipientId}:`, error);
//     }
// };




import { getMessaging, FirebaseProjectKey } from "./firebase";
import { db } from "../models/connection";
import { notifications, users, restaurants, restrauntadmin, restaurantSettings, userFcmTokens } from "../models/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

interface TokenRecord {
    token: string;
    project: FirebaseProjectKey;
    /** how to persist a corrected project guess back to its source row, if we learn it was wrong */
    persistCorrection?: (correctProject: FirebaseProjectKey) => Promise<void>;
}

const OTHER_PROJECT: Record<FirebaseProjectKey, FirebaseProjectKey> = {
    primary: "secondary",
    secondary: "primary",
};

/**
 * FCM error codes that mean "this token does not exist in the project you
 * just tried" — which is exactly what happens when a token minted under
 * Firebase Project A is sent through Project B's Messaging instance. This
 * is the same code used for genuinely expired/uninstalled-app tokens, so we
 * can't tell those apart from a wrong-project token by error code alone —
 * but trying the other project first, and only giving up if BOTH fail, is
 * cheap and correct either way.
 */
function looksLikeWrongProjectOrDeadToken(err: any): boolean {
    const code: string = err?.code || err?.errorInfo?.code || "";
    const msg: string = String(err?.message || err?.errorInfo?.message || "").toLowerCase();

    return (
        code === "messaging/mismatched-credential" ||   // SENDER_ID_MISMATCH: التوكن من بروجكت تاني
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument" ||
        msg.includes("senderid mismatch") ||
        msg.includes("sender_id_mismatch")
    );
}

/**
 * Sends one message to one token. Tries `record.project` first. If that
 * fails with a wrong-project-shaped error, tries the OTHER project. If the
 * other project succeeds, persists the correction (if a persist function
 * was supplied) so next time we go straight to the right project — no
 * repeated failed attempts, no client-side changes ever needed.
 */
async function sendWithAutoHeal(record: TokenRecord, message: any): Promise<void> {
    const primaryTry = record.project;

    try {
        await getMessaging(primaryTry).send({ ...message, token: record.token });
        return; // worked on the first (cached/guessed) project — nothing to heal
    } catch (err) {
        if (!looksLikeWrongProjectOrDeadToken(err)) {
            console.error(`[FCM] Send failed for token ${record.token} on "${primaryTry}" (not a wrong-project error):`, err);
            return;
        }

        const fallback = OTHER_PROJECT[primaryTry];
        try {
            await getMessaging(fallback).send({ ...message, token: record.token });
            console.log(`[FCM] Token ${record.token} was actually on "${fallback}", not "${primaryTry}" — self-healing.`);

            if (record.persistCorrection) {
                try {
                    await record.persistCorrection(fallback);
                } catch (persistErr) {
                    console.error(`[FCM] Sent successfully via "${fallback}" but failed to persist the correction for token ${record.token}:`, persistErr);
                }
            }
        } catch (fallbackErr) {
            // Failed on BOTH projects — genuinely dead/expired token, not a
            // wrong-project issue. Nothing more to do; this token is stale.
            console.error(`[FCM] Token ${record.token} failed on both projects — likely expired/uninstalled:`, fallbackErr);
        }
    }
}

/**
 * Utility to send a push notification via Firebase and save it to the DB.
 *
 * Handles two Firebase projects transparently: each token row carries a
 * cached "best guess" of which project it belongs to (defaults to
 * "primary" for rows created before this existed). If that guess is wrong,
 * sendWithAutoHeal retries on the other project and — on success —
 * self-corrects the stored value, so no app/client code ever needs to
 * declare its project explicitly.
 */
export const sendPushNotification = async (params: {
    recipientType: "user" | "restaurant" | "superadmin";
    recipientId: string;
    branchId?: string | null;
    title: string;
    body: string;
    data?: any;
}) => {
    const { recipientType, recipientId, branchId, title, body, data } = params;

    let payloadData: any = {
        ...(data || {}),
        recipientType,
        recipientId,
        branchId: branchId || data?.branchId || null,
        restaurantId: data?.restaurantId || (recipientType === "restaurant" ? recipientId : null),
        sound: 'notification_sound.wav'
    };

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
        const records: TokenRecord[] = [];
        const seen = new Set<string>();
        const add = (record: TokenRecord | null) => {
            if (!record || !record.token || seen.has(record.token)) return;
            seen.add(record.token);
            records.push(record);
        };

        if (recipientType === "user") {
            const targetRestaurantId = payloadData.restaurantId || data?.restaurantId;

            let userTokens: { id: string; fcmToken: string; firebaseProject: string | null }[] = [];
            if (targetRestaurantId) {
                userTokens = await db
                    .select({ id: userFcmTokens.id, fcmToken: userFcmTokens.fcmToken, firebaseProject: userFcmTokens.firebaseProject })
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
                    .select({ id: userFcmTokens.id, fcmToken: userFcmTokens.fcmToken, firebaseProject: userFcmTokens.firebaseProject })
                    .from(userFcmTokens)
                    .where(eq(userFcmTokens.userId, recipientId));
            }

            for (const t of userTokens) {
                add({
                    token: t.fcmToken,
                    project: (t.firebaseProject as FirebaseProjectKey) || "primary",
                    persistCorrection: async (correct) => {
                        await db.update(userFcmTokens).set({ firebaseProject: correct }).where(eq(userFcmTokens.id, t.id));
                    },
                });
            }

            if (records.length === 0) {
                const [user] = await db
                    .select({ fcmToken: users.fcmToken })
                    .from(users)
                    .where(eq(users.id, recipientId))
                    .limit(1);
                if (user?.fcmToken) {
                    // Legacy field, no id-based persistence target for correction —
                    // just try both projects each time; low volume fallback path.
                    add({ token: user.fcmToken, project: "primary" });
                }
            }
        } else if (recipientType === "restaurant") {
            const [restaurant] = await db
                .select({ fcmToken: restaurants.fcmToken, firebaseProject: restaurants.firebaseProject })
                .from(restaurants)
                .where(eq(restaurants.id, recipientId))
                .limit(1);

            if (restaurant?.fcmToken) {
                add({
                    token: restaurant.fcmToken,
                    project: (restaurant.firebaseProject as FirebaseProjectKey) || "primary",
                    persistCorrection: async (correct) => {
                        await db.update(restaurants).set({ firebaseProject: correct }).where(eq(restaurants.id, recipientId));
                    },
                });
            }

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
                .select({ id: restrauntadmin.id, fcmToken: restrauntadmin.fcmToken, fcmTokenProject: restrauntadmin.firebaseProject })
                .from(restrauntadmin)
                .where(adminConditions);

            for (const adm of admins) {
                if (!adm.fcmToken) continue;
                add({
                    token: adm.fcmToken,
                    project: (adm.fcmTokenProject as FirebaseProjectKey) || "primary",
                    persistCorrection: async (correct) => {
                        await db.update(restrauntadmin).set({ firebaseProject: correct }).where(eq(restrauntadmin.id, adm.id));
                    },
                });
            }
        }

        if (records.length > 0) {
            const message = {
                notification: { title, body },
                data: { payload: JSON.stringify(payloadData) },
                apns: { payload: { aps: { sound: "notification_sound.wav" } } },
            };

            await Promise.all(records.map((record) => sendWithAutoHeal(record, message)));
            console.log(`[FCM] Notification processed for ${records.length} token(s), ${recipientType} ${recipientId}`);
        } else {
            console.log(`[FCM] Skipped push: No FCM token found for ${recipientType} ${recipientId}`);
        }
    } catch (error) {
        console.error(`[FCM] Failed to send push notification to ${recipientType} ${recipientId}:`, error);
    }
};