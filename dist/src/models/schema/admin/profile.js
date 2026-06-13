"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePassword = exports.updateProfile = exports.getProfile = void 0;
const connection_1 = require("../../../models/connection");
const schema_1 = require("../../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../../utils/response");
const Errors_1 = require("../../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const getProfile = async (req, res) => {
    const adminId = req.user?.restaurantId || req.user?.id;
    if (!adminId) {
        throw new Errors_1.UnauthorizedError("Unauthorized");
    }
    const [adminUser] = await connection_1.db
        .select({
        id: schema_1.restrauntadmin.id,
        name: schema_1.restrauntadmin.name,
        email: schema_1.restrauntadmin.email,
        phoneNumber: schema_1.restrauntadmin.phoneNumber,
        type: schema_1.restrauntadmin.type,
        status: schema_1.restrauntadmin.status,
        restaurantId: schema_1.restrauntadmin.restaurantId,
        branchId: schema_1.restrauntadmin.branchId,
        fcmToken: schema_1.restrauntadmin.fcmToken,
        createdAt: schema_1.restrauntadmin.createdAt,
        updatedAt: schema_1.restrauntadmin.updatedAt,
    })
        .from(schema_1.restrauntadmin)
        .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.id, adminId))
        .limit(1);
    if (!adminUser) {
        throw new Errors_1.NotFound("Admin profile not found");
    }
    return (0, response_1.SuccessResponse)(res, { profile: adminUser });
};
exports.getProfile = getProfile;
const updateProfile = async (req, res) => {
    const adminId = req.user?.restaurantId || req.user?.id;
    const { name, phoneNumber, fcmToken } = req.body;
    if (!adminId) {
        throw new Errors_1.UnauthorizedError("Unauthorized");
    }
    const [adminUser] = await connection_1.db
        .select()
        .from(schema_1.restrauntadmin)
        .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.id, adminId))
        .limit(1);
    if (!adminUser) {
        throw new Errors_1.NotFound("Admin profile not found");
    }
    const updateData = {};
    if (name !== undefined)
        updateData.name = name;
    if (phoneNumber !== undefined)
        updateData.phoneNumber = phoneNumber;
    if (fcmToken !== undefined)
        updateData.fcmToken = fcmToken;
    if (Object.keys(updateData).length > 0) {
        await connection_1.db
            .update(schema_1.restrauntadmin)
            .set(updateData)
            .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.id, adminId));
    }
    const [updatedAdmin] = await connection_1.db
        .select({
        id: schema_1.restrauntadmin.id,
        name: schema_1.restrauntadmin.name,
        email: schema_1.restrauntadmin.email,
        phoneNumber: schema_1.restrauntadmin.phoneNumber,
        type: schema_1.restrauntadmin.type,
        status: schema_1.restrauntadmin.status,
        restaurantId: schema_1.restrauntadmin.restaurantId,
        branchId: schema_1.restrauntadmin.branchId,
        fcmToken: schema_1.restrauntadmin.fcmToken,
    })
        .from(schema_1.restrauntadmin)
        .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.id, adminId))
        .limit(1);
    return (0, response_1.SuccessResponse)(res, { message: "Profile updated successfully", profile: updatedAdmin });
};
exports.updateProfile = updateProfile;
const changePassword = async (req, res) => {
    const adminId = req.user?.id;
    const { oldPassword, newPassword } = req.body;
    if (!adminId) {
        throw new Errors_1.UnauthorizedError("Unauthorized");
    }
    if (!oldPassword || !newPassword) {
        throw new Errors_1.BadRequest("Old password and new password are required");
    }
    const [adminUser] = await connection_1.db
        .select()
        .from(schema_1.restrauntadmin)
        .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.id, adminId))
        .limit(1);
    if (!adminUser) {
        throw new Errors_1.NotFound("Admin profile not found");
    }
    const isPasswordValid = await bcrypt_1.default.compare(oldPassword, adminUser.password);
    if (!isPasswordValid) {
        throw new Errors_1.BadRequest("Invalid old password");
    }
    const salt = await bcrypt_1.default.genSalt(10);
    const hashedPassword = await bcrypt_1.default.hash(newPassword, salt);
    await connection_1.db
        .update(schema_1.restrauntadmin)
        .set({ password: hashedPassword })
        .where((0, drizzle_orm_1.eq)(schema_1.restrauntadmin.id, adminId));
    return (0, response_1.SuccessResponse)(res, { message: "Password changed successfully" });
};
exports.changePassword = changePassword;
