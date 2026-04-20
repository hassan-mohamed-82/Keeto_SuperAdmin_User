"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProfile = exports.getProfile = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
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
