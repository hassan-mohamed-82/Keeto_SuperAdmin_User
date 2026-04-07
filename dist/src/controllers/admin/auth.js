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
const BadRequest_1 = require("../../Errors/BadRequest");
const Errors_1 = require("../../Errors");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jwt_1 = require("../../utils/jwt");
async function login(req, res) {
    const { email, password } = req.body;
    if (!email || !password) {
        throw new BadRequest_1.BadRequest("Email and password are required");
    }
    const admin = await connection_1.db.select().from(schema_1.admins).where((0, drizzle_orm_1.eq)(schema_1.admins.email, email));
    if (admin.length === 0) {
        throw new Errors_1.UnauthorizedError("Invalid Credentials");
    }
    const isPasswordValid = await bcrypt_1.default.compare(password, admin[0].password);
    if (!isPasswordValid) {
        throw new Errors_1.UnauthorizedError("Invalid Credentials");
    }
    if (admin[0].status === "inactive") {
        throw new Errors_1.UnauthorizedError("Admin is inactive");
    }
    let role = null;
    if (admin[0].roleId) {
        role = await connection_1.db.select().from(schema_1.roles).where((0, drizzle_orm_1.eq)(schema_1.roles.id, admin[0].roleId));
    }
    const tokenPayload = {
        id: admin[0].id,
        name: admin[0].name,
        role: (role && role[0] ? role[0].name : "admin"),
        // permissions: admin[0].permissions,
    };
    const token = (0, jwt_1.generateAdminToken)(tokenPayload);
    return (0, response_1.SuccessResponse)(res, {
        message: "Admin logged in successfully", token, admin: {
            name: admin[0].name,
            email: admin[0].email,
            phoneNumber: admin[0].phoneNumber,
            roleId: admin[0].roleId,
            permissions: admin[0].permissions,
            status: admin[0].status,
        }
    }, 200);
}
