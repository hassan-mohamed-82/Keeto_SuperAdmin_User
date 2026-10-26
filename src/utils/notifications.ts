import { getMessaging, ADMIN_PROJECT } from "./firebase";
import { db } from "../models/connection";
import {
    notifications, users, restaurants, restrauntadmin,
    restaurantSettings, userFcmTokens, adminFcmTokens
} from "../models/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

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
        sound: "notification_sound.wav"
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

    // 1. حفظ الإشعار
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
        // 2. تجميع التوكنات مع مشروعها
        const records: { token: string; project: string }[] = [];
        const seenTokens = new Set<string>();
        const add = (token: string | null | undefined, project: string) => {
            if (token && !seenTokens.has(token)) {
                seenTokens.add(token);
                records.push({ token, project });
            }
        };

        if (recipientType === "user") {
            const targetRestaurantId = payloadData.restaurantId || data?.restaurantId;

            const userTokens = await db
                .select({ fcmToken: userFcmTokens.fcmToken, firebaseProject: userFcmTokens.firebaseProject })
                .from(userFcmTokens)
                .where(targetRestaurantId
                    ? and(
                        eq(userFcmTokens.userId, recipientId),
                        or(
                            eq(userFcmTokens.restaurantId, targetRestaurantId),
                            sql`${userFcmTokens.restaurantId} IS NULL`
                        )
                    )
                    : eq(userFcmTokens.userId, recipientId));

            for (const t of userTokens) add(t.fcmToken, t.firebaseProject || "primary");

            // legacy fallback
            if (records.length === 0) {
                const [user] = await db
                    .select({ fcmToken: users.fcmToken })
                    .from(users)
                    .where(eq(users.id, recipientId))
                    .limit(1);
                add(user?.fcmToken, "primary");
            }
        } else if (recipientType === "restaurant") {
            // توكن المطعم القديم (legacy)
            const [restaurant] = await db
                .select({ fcmToken: restaurants.fcmToken })
                .from(restaurants)
                .where(eq(restaurants.id, recipientId))
                .limit(1);
            add(restaurant?.fcmToken, ADMIN_PROJECT);

            // توكنات الأدمن (كل الأجهزة) من الجدول الجديد
            const targetBranchId = branchId || payloadData.branchId;

            const admins = await db
                .select({ fcmToken: adminFcmTokens.fcmToken })
                .from(adminFcmTokens)
                .innerJoin(restrauntadmin, eq(restrauntadmin.id, adminFcmTokens.adminId))
                .where(and(
                    eq(restrauntadmin.restaurantId, recipientId),
                    eq(restrauntadmin.status, "active"),
                    targetBranchId
                        ? or(
                            eq(restrauntadmin.branchId, targetBranchId),
                            eq(restrauntadmin.type, "owner"),
                            eq(restrauntadmin.type, "subadmin"))
                        : undefined,
                ));

            for (const adm of admins) add(adm.fcmToken, ADMIN_PROJECT);
        }

        // 3. الإرسال مجمّع حسب المشروع
        if (records.length === 0) {
            console.log(`[FCM] Skipped push: No FCM token found for ${recipientType} ${recipientId}`);
            return;
        }

        const byProject = new Map<string, string[]>();
        for (const r of records) {
            byProject.set(r.project, [...(byProject.get(r.project) || []), r.token]);
        }

        const base = {
            notification: { title, body },
            data: { payload: JSON.stringify(payloadData) },
            android: { notification: { sound: "notification_sound" } },
            apns: { payload: { aps: { sound: "notification_sound.wav" } } },
        };

        for (const [project, tokens] of byProject) {
            let m;
            try {
                m = getMessaging(project);
            } catch (e) {
                console.error(`[FCM] Project "${project}" is not configured:`, e);
                continue;
            }

            for (let i = 0; i < tokens.length; i += 500) {
                const chunk = tokens.slice(i, i + 500);
                const res = await m.sendEachForMulticast({ ...base, tokens: chunk });

                for (let j = 0; j < res.responses.length; j++) {
                    const r = res.responses[j];
                    if (r.success) continue;
                    const code = r.error?.code;

                    if (code === "messaging/registration-token-not-registered") {
                        // توكن ميت: امسحه من كل الجداول
                        const dead = chunk[j];
                        await db.delete(userFcmTokens).where(eq(userFcmTokens.fcmToken, dead));
                        await db.delete(adminFcmTokens).where(eq(adminFcmTokens.fcmToken, dead));
                        await db.update(restaurants).set({ fcmToken: null }).where(eq(restaurants.fcmToken, dead));
                        await db.update(users).set({ fcmToken: null }).where(eq(users.fcmToken, dead));
                    } else {
                        // مشكلة إعدادات (زي mismatched-credential): متمسحش، سجّل بس
                        console.error(`[FCM] ${project} failed (${code}) for ${recipientType} ${recipientId}`);
                    }
                }
                console.log(`[FCM] ${project}: ${res.successCount} ok / ${res.failureCount} failed`);
            }
        }
    } catch (error) {
        console.error(`[FCM] Failed to send push notification to ${recipientType} ${recipientId}:`, error);
    }
};