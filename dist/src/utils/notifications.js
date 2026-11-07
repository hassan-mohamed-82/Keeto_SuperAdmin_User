"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushNotification = void 0;
const firebase_1 = require("./firebase");
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
const sendPushNotification = async (params) => {
    const { recipientType, recipientId, branchId, title, body, data } = params;
    let payloadData = {
        ...(data || {}),
        recipientType,
        recipientId,
        branchId: branchId || data?.branchId || null,
        restaurantId: data?.restaurantId || (recipientType === "restaurant" ? recipientId : null),
        sound: "notification_sound.wav"
    };
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
    // 1. حفظ الإشعار
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
        // 2. تجميع التوكنات مع مشروعها
        const records = [];
        const seenTokens = new Set();
        const add = (token, project) => {
            if (token && !seenTokens.has(token)) {
                seenTokens.add(token);
                records.push({ token, project });
            }
        };
        if (recipientType === "user") {
            const targetRestaurantId = payloadData.restaurantId || data?.restaurantId;
            const userTokens = await connection_1.db
                .select({ fcmToken: schema_1.userFcmTokens.fcmToken, firebaseProject: schema_1.userFcmTokens.firebaseProject })
                .from(schema_1.userFcmTokens)
                .where(targetRestaurantId
                ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.userId, recipientId), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.restaurantId, targetRestaurantId), (0, drizzle_orm_1.sql) `${schema_1.userFcmTokens.restaurantId} IS NULL`))
                : (0, drizzle_orm_1.eq)(schema_1.userFcmTokens.userId, recipientId));
            for (const t of userTokens)
                add(t.fcmToken, t.firebaseProject || "primary");
            // legacy fallback
            if (records.length === 0) {
                const [user] = await connection_1.db
                    .select({ fcmToken: schema_1.users.fcmToken })
                    .from(schema_1.users)
                    .where((0, drizzle_orm_1.eq)(schema_1.users.id, recipientId))
                    .limit(1);
                add(user?.fcmToken, "primary");
            }
        }
        else if (recipientType === "restaurant") {
            // توكن المطعم القديم (legacy)
            const [restaurant] = await connection_1.db
                .select({ fcmToken: schema_1.restaurants.fcmToken })
                .from(schema_1.restaurants)
                .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, recipientId))
                .limit(1);
            add(restaurant?.fcmToken, firebase_1.ADMIN_PROJECT);
            // توكنات الأدمن (كل الأجهزة) من الجدول الجديد
            const targetBranchId = branchId || payloadData.branchId;
            const admins = await connection_1.db
                .select({ fcmToken: schema_1.adminFcmTokens.fcmToken })
                .from(schema_1.adminFcmTokens)
                .innerJoin(schema_1.restrauntadmin, (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.id, schema_1.adminFcmTokens.adminId))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.restaurantId, recipientId), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.status, "active"), targetBranchId
                ? (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.branchId, targetBranchId), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "owner"), (0, drizzle_orm_1.eq)(schema_1.restrauntadmin.type, "subadmin"))
                : undefined));
            for (const adm of admins)
                add(adm.fcmToken, firebase_1.ADMIN_PROJECT);
        }
        // 3. الإرسال مجمّع حسب المشروع
        if (records.length === 0) {
            console.log(`[FCM] Skipped push: No FCM token found for ${recipientType} ${recipientId}`);
            return;
        }
        const byProject = new Map();
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
                m = (0, firebase_1.getMessaging)(project);
            }
            catch (e) {
                console.error(`[FCM] Project "${project}" is not configured:`, e);
                continue;
            }
            for (let i = 0; i < tokens.length; i += 500) {
                const chunk = tokens.slice(i, i + 500);
                const res = await m.sendEachForMulticast({ ...base, tokens: chunk });
                for (let j = 0; j < res.responses.length; j++) {
                    const r = res.responses[j];
                    if (r.success)
                        continue;
                    const code = r.error?.code;
                    if (code === "messaging/registration-token-not-registered") {
                        // توكن ميت: امسحه من كل الجداول
                        const dead = chunk[j];
                        await connection_1.db.delete(schema_1.userFcmTokens).where((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.fcmToken, dead));
                        await connection_1.db.delete(schema_1.adminFcmTokens).where((0, drizzle_orm_1.eq)(schema_1.adminFcmTokens.fcmToken, dead));
                        await connection_1.db.update(schema_1.restaurants).set({ fcmToken: null }).where((0, drizzle_orm_1.eq)(schema_1.restaurants.fcmToken, dead));
                        await connection_1.db.update(schema_1.users).set({ fcmToken: null }).where((0, drizzle_orm_1.eq)(schema_1.users.fcmToken, dead));
                    }
                    else {
                        // مشكلة إعدادات (زي mismatched-credential): متمسحش، سجّل بس
                        console.error(`[FCM] ${project} failed (${code}) for ${recipientType} ${recipientId}`);
                    }
                }
                console.log(`[FCM] ${project}: ${res.successCount} ok / ${res.failureCount} failed`);
            }
        }
    }
    catch (error) {
        console.error(`[FCM] Failed to send push notification to ${recipientType} ${recipientId}:`, error);
    }
};
exports.sendPushNotification = sendPushNotification;
