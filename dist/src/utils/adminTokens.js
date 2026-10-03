"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDeviceType = parseDeviceType;
exports.registerAdminToken = registerAdminToken;
exports.removeAdminToken = removeAdminToken;
const connection_1 = require("../models/connection");
const schema_1 = require("../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const uuid_1 = require("uuid");
function parseDeviceType(v) {
    return v === "ios" || v === "android" || v === "web" ? v : null;
}
async function registerAdminToken(adminId, fcmToken, deviceType) {
    // نفس الجهاز كان عند أدمن تاني؟ امسحه منه
    await connection_1.db.delete(schema_1.adminFcmTokens).where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.adminFcmTokens.fcmToken, fcmToken), (0, drizzle_orm_1.ne)(schema_1.adminFcmTokens.adminId, adminId)));
    await connection_1.db.insert(schema_1.adminFcmTokens)
        .values({ id: (0, uuid_1.v4)(), adminId, fcmToken, deviceType })
        .onDuplicateKeyUpdate({ set: { fcmToken } });
}
// deviceType موجود: يمسح الجهاز ده بس | مش موجود: يمسح كل أجهزة الأدمن
async function removeAdminToken(adminId, deviceType) {
    await connection_1.db.delete(schema_1.adminFcmTokens).where(deviceType
        ? (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.adminFcmTokens.adminId, adminId), (0, drizzle_orm_1.eq)(schema_1.adminFcmTokens.deviceType, deviceType))
        : (0, drizzle_orm_1.eq)(schema_1.adminFcmTokens.adminId, adminId));
}
