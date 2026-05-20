"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateFcmToken = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const BadRequest_1 = require("../../Errors/BadRequest");
// ==========================================
// Update FCM Token for User
// ==========================================
const updateFcmToken = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { fcmToken } = req.body;
    if (!fcmToken) {
        throw new BadRequest_1.BadRequest("FCM Token is required");
    }
    await connection_1.db.update(schema_1.users)
        .set({ fcmToken })
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
    return (0, response_1.SuccessResponse)(res, { message: "FCM token updated successfully" });
};
exports.updateFcmToken = updateFcmToken;
