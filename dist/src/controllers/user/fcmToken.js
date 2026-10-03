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
// Update FCM Token for User 
// ==========================================
const updateFcmToken = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { fcmToken, restaurantId, deviceType } = req.body;
    const tokenToSave = fcmToken && String(fcmToken).trim() !== "" ? String(fcmToken).trim() : null;
    const devType = deviceType === "ios" || deviceType === "android" ? deviceType : "web";
    // fallback القديم
    await connection_1.db.update(schema_1.users).set({ fcmToken: tokenToSave }).where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
    if (restaurantId) {
        if (tokenToSave) {
            let projectToSave = "primary";
            if (devType !== "web") {
                const [restaurant] = await connection_1.db
                    .select({ ios: schema_1.restaurants.iosFirebaseProject, android: schema_1.restaurants.androidFirebaseProject })
                    .from(schema_1.restaurants)
                    .where((0, drizzle_orm_1.eq)(schema_1.restaurants.id, restaurantId))
                    .limit(1);
                if (restaurant) {
                    projectToSave = (devType === "ios" ? restaurant.ios : restaurant.android) || "primary";
                }
            }
            // نفس التوكن عند يوزر تاني؟ امسحه
            await connection_1.db.delete(schema_1.userFcmTokens).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.fcmToken, tokenToSave), (0, drizzle_orm_1.ne)(schema_1.userFcmTokens.userId, userId)));
            // الصف بيتحدد بـ (يوزر + مطعم + نوع الجهاز)
            const [existing] = await connection_1.db.select().from(schema_1.userFcmTokens).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userFcmTokens.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.userFcmTokens.deviceType, devType))).limit(1);
            if (existing) {
                await connection_1.db.update(schema_1.userFcmTokens)
                    .set({ fcmToken: tokenToSave, firebaseProject: projectToSave, updatedAt: new Date() })
                    .where((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.id, existing.id));
            }
            else {
                await connection_1.db.insert(schema_1.userFcmTokens).values({
                    id: (0, uuid_1.v4)(),
                    userId,
                    restaurantId,
                    fcmToken: tokenToSave,
                    deviceType: devType,
                    firebaseProject: projectToSave
                });
            }
        }
        else {
            // logout: امسح توكن الجهاز ده بس
            await connection_1.db.delete(schema_1.userFcmTokens).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.userId, userId), (0, drizzle_orm_1.eq)(schema_1.userFcmTokens.restaurantId, restaurantId), (0, drizzle_orm_1.eq)(schema_1.userFcmTokens.deviceType, devType)));
        }
    }
    else if (!tokenToSave) {
        await connection_1.db.delete(schema_1.userFcmTokens).where((0, drizzle_orm_1.eq)(schema_1.userFcmTokens.userId, userId));
    }
    return (0, response_1.SuccessResponse)(res, {
        message: tokenToSave ? "FCM token updated successfully" : "FCM token removed successfully"
    });
};
exports.updateFcmToken = updateFcmToken;
