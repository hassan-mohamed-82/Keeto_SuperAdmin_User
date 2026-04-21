"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZones = exports.updateUserAddress = exports.deleteUserAddress = exports.addUserAddress = exports.getUserAddresses = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const uuid_1 = require("uuid");
const getUserAddresses = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const userAddresses = await connection_1.db.select().from(schema_1.addresses).where((0, drizzle_orm_1.eq)(schema_1.addresses.userId, userId));
    return (0, response_1.SuccessResponse)(res, { data: userAddresses });
};
exports.getUserAddresses = getUserAddresses;
const addUserAddress = async (req, res) => {
    try {
        if (!req.user)
            throw new Errors_1.UnauthorizedError("Unauthenticated");
        const userId = req.user.id;
        const { type, title, street, number, floor, zoneId } = req.body;
        const newAddress = await connection_1.db.insert(schema_1.addresses).values({
            id: (0, uuid_1.v4)(),
            userId,
            type,
            title,
            street,
            number,
            zoneId,
            floor,
        });
        return (0, response_1.SuccessResponse)(res, { message: "Address added successfully", data: newAddress });
    }
    catch (error) {
        // السطر ده هيفضح المشكلة الحقيقية في التيرمينال
        console.error("🔥 MYSQL ERROR DETAILS:", error);
        throw error;
    }
};
exports.addUserAddress = addUserAddress;
const deleteUserAddress = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { addressId } = req.params;
    const existingAddress = await connection_1.db.select().from(schema_1.addresses).where((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId)).limit(1);
    if (!existingAddress[0]) {
        throw new Errors_1.NotFound("Address not found");
    }
    await connection_1.db.delete(schema_1.addresses).where((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId));
    return (0, response_1.SuccessResponse)(res, { message: "Address deleted successfully" });
};
exports.deleteUserAddress = deleteUserAddress;
const updateUserAddress = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const userId = req.user.id;
    const { addressId } = req.params;
    const { type, title, street, number, floor } = req.body;
    const existingAddress = await connection_1.db.select().from(schema_1.addresses).where((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId)).limit(1);
    if (!existingAddress[0]) {
        throw new Errors_1.NotFound("Address not found");
    }
    await connection_1.db
        .update(schema_1.addresses)
        .set({ type, title, street, number, floor, zoneId: req.body.zoneId })
        .where((0, drizzle_orm_1.eq)(schema_1.addresses.id, addressId));
    return (0, response_1.SuccessResponse)(res, { message: "Address updated successfully" });
};
exports.updateUserAddress = updateUserAddress;
const getZones = async (req, res) => {
    if (!req.user)
        throw new Errors_1.UnauthorizedError("Unauthenticated");
    const zone = await connection_1.db.select().from(schema_1.zones);
    return (0, response_1.SuccessResponse)(res, { data: zone });
};
exports.getZones = getZones;
