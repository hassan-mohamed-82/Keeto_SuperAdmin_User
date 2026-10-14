"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCompanyUser = exports.updateCompanyUser = exports.createCompanyUser = exports.getCompanyUsers = void 0;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const catchAsync_1 = require("../../utils/catchAsync");
// =========================================================================
// 1. Get all company users (admin only)
// =========================================================================
exports.getCompanyUsers = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const users = await connection_1.db
        .select({
        id: schema_1.shippingCompanyUsers.id,
        shippingCompanyId: schema_1.shippingCompanyUsers.shippingCompanyId,
        name: schema_1.shippingCompanyUsers.name,
        email: schema_1.shippingCompanyUsers.email,
        phone: schema_1.shippingCompanyUsers.phone,
        role: schema_1.shippingCompanyUsers.role,
        status: schema_1.shippingCompanyUsers.status,
        createdAt: schema_1.shippingCompanyUsers.createdAt,
        updatedAt: schema_1.shippingCompanyUsers.updatedAt,
    })
        .from(schema_1.shippingCompanyUsers)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.shippingCompanyId, companyId));
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping company users retrieved successfully",
        data: users,
    });
});
// =========================================================================
// 2. Create company user (admin only)
// =========================================================================
exports.createCompanyUser = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const { name, email, password, phone, role = "dispatcher" } = req.body;
    // Check duplicate email
    const [existing] = await connection_1.db
        .select({ id: schema_1.shippingCompanyUsers.id })
        .from(schema_1.shippingCompanyUsers)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.email, email))
        .limit(1);
    if (existing) {
        throw new Errors_1.ConflictError("Email already in use by another user");
    }
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    const [insertResult] = await connection_1.db.insert(schema_1.shippingCompanyUsers).values({
        shippingCompanyId: companyId,
        name,
        email,
        password: hashedPassword,
        phone,
        role,
        status: "active",
        tokenVersion: 0,
    });
    const [newUser] = await connection_1.db
        .select({
        id: schema_1.shippingCompanyUsers.id,
        shippingCompanyId: schema_1.shippingCompanyUsers.shippingCompanyId,
        name: schema_1.shippingCompanyUsers.name,
        email: schema_1.shippingCompanyUsers.email,
        phone: schema_1.shippingCompanyUsers.phone,
        role: schema_1.shippingCompanyUsers.role,
        status: schema_1.shippingCompanyUsers.status,
        createdAt: schema_1.shippingCompanyUsers.createdAt,
    })
        .from(schema_1.shippingCompanyUsers)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.email, email))
        .limit(1);
    return (0, response_1.SuccessResponse)(res, {
        message: "Shipping company user created successfully",
        data: newUser,
    }, 201);
});
// =========================================================================
// 3. Update company user (admin only)
// =========================================================================
exports.updateCompanyUser = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    const [user] = await connection_1.db
        .select()
        .from(schema_1.shippingCompanyUsers)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.id, id), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.shippingCompanyId, companyId)))
        .limit(1);
    if (!user) {
        throw new Errors_1.NotFound("User not found");
    }
    const { name, email, password, phone, role, status } = req.body;
    const updateData = {};
    if (name !== undefined)
        updateData.name = name;
    if (phone !== undefined)
        updateData.phone = phone;
    if (role !== undefined)
        updateData.role = role;
    if (status !== undefined) {
        updateData.status = status;
        // Invalidate tokens when user is deactivated
        if (status === "inactive") {
            updateData.tokenVersion = user.tokenVersion + 1;
        }
    }
    if (email && email !== user.email) {
        const [existing] = await connection_1.db
            .select({ id: schema_1.shippingCompanyUsers.id })
            .from(schema_1.shippingCompanyUsers)
            .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.email, email))
            .limit(1);
        if (existing) {
            throw new Errors_1.ConflictError("Email already in use by another user");
        }
        updateData.email = email;
    }
    if (password) {
        updateData.password = await bcrypt_1.default.hash(password, 10);
        // Increment tokenVersion to revoke active tokens upon password change
        updateData.tokenVersion = user.tokenVersion + 1;
    }
    await connection_1.db
        .update(schema_1.shippingCompanyUsers)
        .set(updateData)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "User updated successfully",
    });
});
// =========================================================================
// 4. Delete company user (admin only, cannot delete oneself)
// =========================================================================
exports.deleteCompanyUser = (0, catchAsync_1.catchAsync)(async (req, res) => {
    const companyId = req.user?.shippingCompanyId;
    const currentUserId = req.user?.id;
    const { id } = req.params;
    if (!companyId) {
        throw new Errors_1.UnauthorizedError("Unauthorized access");
    }
    if (id === currentUserId) {
        throw new Errors_1.BadRequest("You cannot delete your own account");
    }
    const [user] = await connection_1.db
        .select()
        .from(schema_1.shippingCompanyUsers)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.id, id), (0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.shippingCompanyId, companyId)))
        .limit(1);
    if (!user) {
        throw new Errors_1.NotFound("User not found");
    }
    await connection_1.db
        .delete(schema_1.shippingCompanyUsers)
        .where((0, drizzle_orm_1.eq)(schema_1.shippingCompanyUsers.id, id));
    return (0, response_1.SuccessResponse)(res, {
        message: "User deleted successfully",
    });
});
