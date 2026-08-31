"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateFcmToken = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const uuid_1 = require("uuid");
// ==========================================
// Update FCM Token for User (Per Restaurant / Multi-Tenant Support)
// ==========================================
const updateFcmToken = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { fcmToken, restaurantId, deviceType } = req.body;
    const tokenToSave = fcmToken && String(fcmToken).trim() !== "" ? String(fcmToken).trim() : null;
    // 1. Update fallback token in main users table
    await connection_1.db.update(schema_1.users)
        .set({ fcmToken: tokenToSave })
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
    // 2. Manage user_fcm_tokens table
    if (restaurantId) {
        if (tokenToSave) {
            const [existing] = await connection_1.db
                .select()
                .from(schema_1.userFcmTokens)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userFcmTokens.restaurantId, restaurantId)))
                .limit(1);
            if (existing) {
                await connection_1.db.update(schema_1.userFcmTokens)
                    .set({
                    fcmToken: tokenToSave,
                    deviceType: deviceType || existing.deviceType || "android",
                    updatedAt: new Date()
                })
                    .where((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.id, existing.id));
            }
            else {
                await connection_1.db.insert(schema_1.userFcmTokens).values({
                    id: (0, uuid_1.v4)(),
                    userId,
                    restaurantId,
                    fcmToken: tokenToSave,
                    deviceType: deviceType || "android"
                });
            }
        }
        else {
            await connection_1.db.delete(schema_1.userFcmTokens)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userFcmTokens.restaurantId, restaurantId)));
        }
    }
    else if (!tokenToSave) {
        await connection_1.db.delete(schema_1.userFcmTokens)
            .where((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.userId, userId));
    }
    return (0, response_1.SuccessResponse)(res, { message: tokenToSave ? "FCM token updated successfully" : "FCM token removed successfully" });
};
exports.updateFcmToken = updateFcmToken;
