"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.changepassword = exports.updateProfile = exports.getProfile = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const getProfile = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const [userInfo] = await connection_1.db
        .select({
        id: schema_1.users.id,
        name: schema_1.users.name,
        email: schema_1.users.email,
        phone: schema_1.users.phone,
        photo: schema_1.users.photo,
        isVerified: schema_1.users.isVerified,
        createdAt: schema_1.users.createdAt,
    })
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId))
        .limit(1);
    const [wallet] = await connection_1.db
        .select({
        balance: schema_1.userWallets.balance
    })
        .from(schema_1.userWallets)
        .where((0, drizzle_orm_1.eq)(schema_1.userWallets.userId, userId))
        .limit(1);
    return (0, response_1.SuccessResponse)(res, {
        data: {
            user: {
                id: userInfo.id,
                name: userInfo.name,
                email: userInfo.email,
                phone: userInfo.phone,
                photo: userInfo.photo,
                isVerified: userInfo.isVerified,
                createdAt: userInfo.createdAt,
            },
            walletBalance: wallet?.balance || "0.00",
        }
    });
};
exports.getProfile = getProfile;
const updateProfile = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { name, phone, photo } = req.body;
    await connection_1.db.update(schema_1.users)
        .set({ name, phone, photo })
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
    return (0, response_1.SuccessResponse)(res, { message: "Profile updated successfully" });
};
exports.updateProfile = updateProfile;
const changepassword = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user?.id || req.user?._id;
    const { oldPassword, newPassword } = req.body;
    if (!userId) {
        throw new Errors_1.UnauthorizedError("Unauthorized");
    }
    if (!oldPassword || !newPassword) {
        throw new Errors_1.BadRequest("Old password and new password are required");
    }
    const [user] = await connection_1.db
        .select()
        .from(schema_1.users)
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId))
        .limit(1);
    if (!user) {
        throw new Errors_1.NotFound("Admin profile not found");
    }
    if (!user.password) {
        throw new Errors_1.BadRequest("Cannot change password for this account");
    }
    const isPasswordValid = await bcrypt_1.default.compare(oldPassword, user.password);
    if (!isPasswordValid) {
        throw new Errors_1.BadRequest("Invalid old password");
    }
    const salt = await bcrypt_1.default.genSalt(10);
    const hashedPassword = await bcrypt_1.default.hash(newPassword, salt);
    await connection_1.db
        .update(schema_1.users)
        .set({ password: hashedPassword })
        .where((0, drizzle_orm_1.eq)(schema_1.users.id, userId));
    return (0, response_1.SuccessResponse)(res, { message: "Password changed successfully" });
};
exports.changepassword = changepassword;
