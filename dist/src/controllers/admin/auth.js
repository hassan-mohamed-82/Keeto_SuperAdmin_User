"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
const connection_1 = require("../../models/connection");
const schema_1 = require("../../models/schema");
const drizzle_orm_1 = require("drizzle-orm");
const response_1 = require("../../utils/response");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jwt_1 = require("../../utils/jwt");
async function login(req, res) {
    const { email, password } = req.body;
    if (!email || !password) {
        throw new Errors_1.BadRequest("Email and password are required");
    }
    // جلب الأدمن مع الرول باستخدام LEFT JOIN
    const result = await connection_1.db
        .select({
        admin: schema_1.admins,
        role: schema_1.rolesadmin,
    })
        .from(schema_1.admins)
        .leftJoin(schema_1.rolesadmin, (0, drizzle_orm_1.eq)(schema_1.admins.roleId, schema_1.rolesadmin.id))
        .where((0, drizzle_orm_1.eq)(schema_1.admins.email, email));
    if (result.length === 0) {
        throw new Errors_1.UnauthorizedError("Invalid Credentials");
    }
    const { admin, role } = result[0]; // فصل بيانات الأدمن والرول
    const isPasswordValid = await bcrypt_1.default.compare(password, admin.password);
    if (!isPasswordValid) {
        throw new Errors_1.UnauthorizedError("Invalid Credentials");
    }
    if (admin.status === "inactive") {
        throw new Errors_1.UnauthorizedError("Admin is inactive");
    }
    const tokenPayload = {
        id: admin.id,
        name: admin.name,
        type: admin.type,
    };
    const token = (0, jwt_1.generateAdminToken)(tokenPayload);
    // تحويل الصلاحيات من نص إلى مصفوفة (JSON Object) إذا لزم الأمر
    const parsedAdminPermissions = typeof admin.permissions === "string"
        ? JSON.parse(admin.permissions)
        : (admin.permissions || []);
    const parsedRolePermissions = (role && typeof role.permissions === "string")
        ? JSON.parse(role.permissions)
        : (role ? role.permissions : []);
    return (0, response_1.SuccessResponse)(res, {
        message: "Admin logged in successfully",
        token,
        admin: {
            name: admin.name,
            email: admin.email,
            phoneNumber: admin.phoneNumber,
            role: role ? {
                ...role,
                permissions: parsedRolePermissions // الصلاحيات بعد التحويل
            } : null,
            permissions: parsedAdminPermissions, // الصلاحيات بعد التحويل
            status: admin.status,
            type: admin.type
        }
    }, 200);
}
