"use strict";
// controllers/admin.controller.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.select = exports.toggleAdminStatus = exports.deleteAdmin = exports.updateAdmin = exports.getAdminById = exports.getAllAdmins = exports.createAdmin = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const NotFound_1 = require("../../Errors/NotFound");
const BadRequest_1 = require("../../Errors/BadRequest");
const bcrypt_1 = __importDefault(require("bcrypt"));
const uuid_1 = require("uuid");
const createAdmin = async (req, res) => {
    const { name, email, phoneNumber, password, roleId } = req.body;
    const existingAdmin = await connection_1.db
        .select()
        .from(schema_1.admins)
        .where((0, drizzle_orm_1.eq)(schema_1.admins.email, email));
    if (existingAdmin.length > 0) {
        throw new BadRequest_1.BadRequest("email is already exists");
    }
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    const id = (0, uuid_1.v4)();
    await connection_1.db.insert(schema_1.admins).values({
        id,
        name,
        email,
        phoneNumber,
        password: hashedPassword,
        roleId,
    });
    return (0, response_1.SuccessResponse)(res, { message: "create admin success", data: { id } });
};
exports.createAdmin = createAdmin;
const getAllAdmins = async (req, res) => {
    const allAdmins = await connection_1.db
        .select({
        id: schema_1.admins.id,
        name: schema_1.admins.name,
        email: schema_1.admins.email,
        phoneNumber: schema_1.admins.phoneNumber,
        status: schema_1.admins.status,
        createdAt: schema_1.admins.createdAt,
        updatedAt: schema_1.admins.updatedAt,
        // بيانات الـ Role
        role: {
            id: schema_1.roles.id,
            name: schema_1.roles.name,
            permissions: schema_1.roles.permissions,
            status: schema_1.roles.status,
        },
    })
        .from(schema_1.admins)
        .leftJoin(schema_1.roles, (0, drizzle_orm_1.eq)(schema_1.admins.roleId, schema_1.roles.id));
    return (0, response_1.SuccessResponse)(res, {
        message: "get all admins success",
        data: allAdmins
    });
};
exports.getAllAdmins = getAllAdmins;
const getAdminById = async (req, res) => {
    const { id } = req.params;
    const admin = await connection_1.db
        .select({
        id: schema_1.admins.id,
        name: schema_1.admins.name,
        email: schema_1.admins.email,
        phoneNumber: schema_1.admins.phoneNumber,
        status: schema_1.admins.status,
        createdAt: schema_1.admins.createdAt,
        updatedAt: schema_1.admins.updatedAt,
        // بيانات الـ Role
        role: {
            id: schema_1.roles.id,
            name: schema_1.roles.name,
            permissions: schema_1.roles.permissions,
            status: schema_1.roles.status,
        },
    })
        .from(schema_1.admins)
        .leftJoin(schema_1.roles, (0, drizzle_orm_1.eq)(schema_1.admins.roleId, schema_1.roles.id))
        .where((0, drizzle_orm_1.eq)(schema_1.admins.id, id));
    if (admin.length === 0) {
        throw new NotFound_1.NotFound("admin not found");
    }
    return (0, response_1.SuccessResponse)(res, {
        message: "get admin by id success",
        data: admin[0]
    });
};
exports.getAdminById = getAdminById;
const updateAdmin = async (req, res) => {
    const { id } = req.params;
    const { name, email, phoneNumber, roleId } = req.body;
    const existingAdmin = await connection_1.db
        .select()
        .from(schema_1.admins)
        .where((0, drizzle_orm_1.eq)(schema_1.admins.id, id));
    if (existingAdmin.length === 0) {
        throw new NotFound_1.NotFound("admin not found");
    }
    const updateData = {
        updatedAt: new Date()
    };
    if (name)
        updateData.name = name;
    if (email)
        updateData.email = email;
    if (phoneNumber)
        updateData.phoneNumber = phoneNumber;
    if (roleId)
        updateData.roleId = roleId;
    if (Object.keys(updateData).length === 1) {
        throw new BadRequest_1.BadRequest("no data to update");
    }
    await connection_1.db
        .update(schema_1.admins)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.admins.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "update admin success" });
};
exports.updateAdmin = updateAdmin;
const deleteAdmin = async (req, res) => {
    const { id } = req.params;
    const admin = await connection_1.db
        .select()
        .from(schema_1.admins)
        .where((0, drizzle_orm_1.eq)(schema_1.admins.id, id));
    if (admin.length === 0) {
        throw new NotFound_1.NotFound("admin not found");
    }
    await connection_1.db.delete(schema_1.admins).where((0, drizzle_orm_1.eq)(schema_1.admins.id, id));
    return (0, response_1.SuccessResponse)(res, { message: "delete admin success" });
};
exports.deleteAdmin = deleteAdmin;
const toggleAdminStatus = async (req, res) => {
    const { id } = req.params;
    const admin = await connection_1.db
        .select()
        .from(schema_1.admins)
        .where((0, drizzle_orm_1.eq)(schema_1.admins.id, id));
    if (admin.length === 0) {
        throw new NotFound_1.NotFound("admin not found");
    }
    const newStatus = admin[0].status === "active" ? "inactive" : "active";
    await connection_1.db
        .update(schema_1.admins)
        .set({
        status: newStatus,
        updatedAt: new Date()
    })
        .where((0, drizzle_orm_1.eq)(schema_1.admins.id, id));
    return (0, response_1.SuccessResponse)(res, { message: `toggle admin status success` });
};
exports.toggleAdminStatus = toggleAdminStatus;
const select = async (req, res) => {
    const allroles = await connection_1.db.select().from(schema_1.roles);
    return (0, response_1.SuccessResponse)(res, { message: "get all roles success", data: allroles });
};
exports.select = select;
